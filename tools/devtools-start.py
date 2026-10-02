#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
微信开发者工具「服务端口」启动器
================================

解决的问题
----------
命令行工具 cli.bat 要用，必须让 IDE 带 --enable-service-port 启动。
但 CLI 自身在检测到端口关闭时只会报错退出，不会替你把 IDE 重启起来。

本脚本做的事
------------
1. 检测 IDE 是否在运行
   - 在运行 → 判断服务端口是否已开；没开则给出「需要做什么」的明确提示
   - 未运行 → 带 --enable-service-port 以脱离方式启动，并轮询等待端口就绪
2. 就绪后用 cli.bat islogin 做一次真实验证

用法
----
    python tools/devtools-start.py                  # 检测 + 必要时启动
    python tools/devtools-start.py --check          # 只检测，不启动、不关闭
    python tools/devtools-start.py --force-restart  # 允许先关掉旧实例再启动

设计原则：**默认永不擅自结束你的进程**。IDE 正开着时，脚本只报告状态并告诉你
该做什么；只有显式加 --force-restart 才会关闭它。

关键路径推导（已从 CLI 源码确认，见 SKILL 说明）
------------
    userDirPath = %USERPROFILE%\\AppData\\Local\\微信开发者工具\\User Data\\<hash>\\Default
    该目录下的 .ide / .ide-status / .cli 三个文件是 CLI 与 IDE 之间的握手凭据：
      .cli        CLI 自己写的端口（调一次 cli.bat 就会生成）
      .ide        IDE 写的服务端口（IDE 带 --enable-service-port 启动后才有）
      .ide-status 内容必须是 "On"，否则 CLI 直接报「服务端口已关闭」并退出
"""

import ctypes
import os
import socket
import subprocess
import sys
import time
from ctypes import wintypes

def _find_devtools_dir():
    """按候选列表找开发者工具安装目录。

    别写死 C:\\Program Files —— 本机就装在 D 盘。候选顺序：
    环境变量 → 本机实测路径 → 官方默认路径。
    """
    env = os.environ.get("WECHAT_DEVTOOLS_DIR")
    if env and os.path.exists(os.path.join(env, "微信开发者工具.exe")):
        return env
    cands = [
        r"D:\NYT\todesk\小程序\微信web开发者工具",
        r"C:\Program Files (x86)\Tencent\微信web开发者工具",
        r"C:\Program Files\Tencent\微信web开发者工具",
    ]
    for c in cands:
        if os.path.exists(os.path.join(c, "微信开发者工具.exe")):
            return c
    return cands[-1]          # 都找不到就回落到官方默认，报错信息里会带上路径


DEVTOOLS_DIR = _find_devtools_dir()
DEVTOOLS_EXE = os.path.join(DEVTOOLS_DIR, "微信开发者工具.exe")
CLI_BAT = os.path.join(DEVTOOLS_DIR, "cli.bat")

SERVICE_PORTS = (9420, 9421, 9422)          # 仅作兜底候选；**真实端口不在这里**
PROC_NAME = "微信开发者工具.exe"


# ---------------------------------------------------------------- 基础工具

def user_dir():
    """定位握手目录。

    CLI 源码里是 md5(安装路径) 决定 User Data 下的子目录名，但具体摘要算法
    不好复刻（试过 md5(dir) 对不上）。改成直接扫描：挑出含 Default/ 子目录的
    那一份，多个时优先带 WeappLocalData 的（即真正在用的一份）。
    """
    root = os.path.join(
        os.environ.get("USERPROFILE", os.path.expanduser("~")),
        "AppData", "Local", "微信开发者工具", "User Data",
    )
    if not os.path.isdir(root):
        return root
    cands = [os.path.join(root, n, "Default")
             for n in os.listdir(root)
             if os.path.isdir(os.path.join(root, n, "Default"))]
    if not cands:
        return root
    with_data = [c for c in cands
                 if os.path.isdir(os.path.join(os.path.dirname(c), "WeappLocalData"))]
    pool = with_data or cands
    # 多个时取最近改动过的
    pool.sort(key=lambda p: os.path.getmtime(os.path.dirname(p)), reverse=True)
    return pool[0]


def running_pids():
    out = subprocess.run(["tasklist", "/FO", "CSV", "/NH"],
                         capture_output=True).stdout.decode("gbk", errors="replace")
    pids = []
    for line in out.splitlines():
        if PROC_NAME in line:
            parts = [x.strip('"') for x in line.split('","')]
            try:
                pids.append(int(parts[1]))
            except (IndexError, ValueError):
                pass
    return pids


def open_ports():
    """探测服务端口。

    ★ 2026-09-24 更正：服务端口**不是** 9420/9421/9422 这种固定候选，
      而是 IDE 每次启动随机挑的高位端口（实测拿到 51056）。
      唯一可靠的判据是：读 `<userDir>/.ide` 里写的那个端口，再探连它。
      9420/9421/9422 仅作兜底（那是 miniprogram-automator 的 automation 端口，
      与 CLI 的 service port 是两码事，别混）。
    """
    hits = []
    d, info = handshake_files()
    ide = (info.get(".ide") or "").strip()
    cands = []
    if ide.isdigit():
        cands.append(int(ide))
    cands += [p for p in SERVICE_PORTS if p not in cands]
    for p in cands:
        try:
            s = socket.create_connection(("127.0.0.1", p), 1)
            s.close()
            hits.append(p)
        except OSError:
            pass
    return hits


def handshake_files():
    d = user_dir()
    info = {}
    for name in (".ide", ".ide-status", ".cli"):
        fp = os.path.join(d, name)
        if os.path.exists(fp):
            try:
                info[name] = open(fp, encoding="utf-8", errors="replace").read().strip()
            except OSError:
                info[name] = "<读取失败>"
        else:
            info[name] = None
    return d, info


def can_terminate():
    """探测：当前权限能不能结束 IDE 进程。

    方式：用 PROCESS_TERMINATE 打开根进程。同用户同权限级别必然成功；
    失败且 GetLastError()==5(ERROR_ACCESS_DENIED) 即说明对方权限更高
    （典型是以管理员身份启动的实例）。
    只打开句柄、不做任何操作，无副作用。
    """
    pids = running_pids()
    if not pids:
        return True
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    PROCESS_TERMINATE = 0x0001
    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    for pid in pids:
        h = kernel32.OpenProcess(PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not h:
            if ctypes.get_last_error() == 5:      # ERROR_ACCESS_DENIED
                return False
            continue
        kernel32.CloseHandle(wintypes.HANDLE(h))
    return True


# ---------------------------------------------------------------- 主流程

def launch():
    exe_dir = os.path.dirname(DEVTOOLS_EXE)
    DETACHED = 0x00000008
    NEW_GROUP = 0x00000200
    kwargs = dict(
        cwd=exe_dir, close_fds=True,
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    p = subprocess.Popen([DEVTOOLS_EXE, "--enable-service-port"],
                         creationflags=DETACHED | NEW_GROUP, **kwargs)
    return p.pid


def wait_ready(timeout=120):
    deadline = time.time() + timeout
    while time.time() < deadline:
        ports = open_ports()
        if ports:
            return ports
        time.sleep(4)
    return []


def verify_cli():
    if not os.path.exists(CLI_BAT):
        return False, "cli.bat 不存在"
    r = subprocess.run([CLI_BAT, "islogin"], cwd=DEVTOOLS_DIR,
                       capture_output=True, timeout=120)
    txt = (r.stdout + r.stderr).decode("gbk", errors="replace")
    ok = "service port disabled" not in txt
    return ok, txt.strip()[-400:]


def main():
    check_only = "--check" in sys.argv

    print("=" * 62)
    print("微信开发者工具 · 服务端口启动器")
    print("=" * 62)

    d, files = handshake_files()
    print(f"\n握手目录: {d}")
    for k, v in files.items():
        print(f"  {k:<12} {'→ ' + repr(v) if v is not None else '（不存在）'}")

    pids = running_pids()
    print(f"\nIDE 进程: {'运行中，' + str(len(pids)) + ' 个 PID ' + str(pids) if pids else '未运行'}")

    ports = open_ports()
    print(f"服务端口: {ports if ports else '全部关闭'}")

    # —— 情况一：端口已经开着，直接验证走人
    if ports:
        ok, msg = verify_cli()
        print(f"\n[{('成功' if ok else '异常')}] cli.bat islogin\n{msg}")
        print("\n可以去跑端到端验证了：")
        print('  NODE_PATH="<装有 miniprogram-automator 的 node_modules>" \\')
        print('    node tools/e2e-simulator.js')
        return 0 if ok else 1

    # —— 情况二：IDE 在跑但没端口
    if pids:
        print("\nIDE 正在运行，但没有开服务端口。")
        able = can_terminate()
        print(f"  能否由本脚本结束该实例：{'可以' if able else '不可以（进程权限更高，典型是「以管理员身份运行」）'}")

        if not able:
            print("""
  → 需要你做一件事（二选一，都是一次性的）：
     ① 切到开发者工具窗口，Alt+F4（或点 ×）完全退出，然后再运行一次本脚本
     ② 或在工具里：设置 → 安全设置 → 服务端口 → 打开
        （这条可能要求重启工具，重启后本脚本即可接管）
""")
            return 1

        if check_only or "--force-restart" not in sys.argv:
            print("""
  → 正解（2026-09-24 实测唯一可靠）：让 IDE 带 --enable-service-port 重开一次。
     双击项目根目录的「启动开发者工具.cmd」即可 —— 它会先检查、再带参数启动。
     带一次参数之后设置会被持久化，以后普通启动也会自动开。

     也可以在这里加 --force-restart 试自动关闭，
     但实测那 6 个实例常拒绝终止（权限更高），失败就照上面用 .cmd。
""")
            return 1

        print("  --force-restart：尝试关闭旧实例…")
        subprocess.run(["taskkill", "/F", "/IM", PROC_NAME, "/T"], capture_output=True)
        time.sleep(6)
        left = running_pids()
        if left:
            print(f"  ⚠️  仍有 {len(left)} 个进程存活。")
            print("     实测常见结果：该实例权限更高，普通权限终止不了（taskkill 报「拒绝访问」）。")
            print("     → 请你手动退出开发者工具（Alt+F4），再双击「启动开发者工具.cmd」。")
            return 1
        print("  已关闭。")

    # —— 启动
    if check_only:
        print("\n（--check 模式，不启动）")
        return 1

    print("\n带 --enable-service-port 启动 IDE …")
    pid = launch()
    print(f"  已发起，PID = {pid}")
    ports = wait_ready()
    if ports:
        print(f"  ✓ 服务端口已就绪: {ports}")
    else:
        print("  ✗ 等待超时，端口仍未开")

    d, files = handshake_files()
    for k, v in files.items():
        print(f"  {k:<12} {'→ ' + repr(v) if v is not None else '（不存在）'}")

    ok, msg = verify_cli()
    print(f"\n[{('成功' if ok else '失败')}] cli.bat islogin\n{msg}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
