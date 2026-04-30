#!/usr/bin/env python3
"""
EnderRealm Assistant Agent - 测试脚本
支持创建会话、聊天、获取上下文、导出/导入等操作
"""

import json
import sys
from typing import Optional

try:
    import requests
except ImportError:
    print("请先安装 requests: pip install requests")
    sys.exit(1)

BASE_URL = "http://localhost:8787"

session_id: Optional[str] = None
session_token: Optional[str] = None


def headers():
    """构建请求头"""
    h = {"Content-Type": "application/json"}
    if session_token:
        h["X-Session-Token"] = session_token
    return h


def cmd_create():
    """创建新会话"""
    global session_id, session_token
    resp = requests.post(f"{BASE_URL}/api/session/create", headers={"Content-Type": "application/json"})
    if resp.status_code != 201:
        print(f"创建失败: {resp.text}")
        return

    data = resp.json()
    session_id = data["id"]
    session_token = data["token"]
    print(f"✓ 会话创建成功")
    print(f"  Session ID: {session_id}")
    print(f"  Token: {session_token}")


def cmd_chat(message: str):
    """发送消息"""
    if not session_id or not session_token:
        print("请先创建会话 (command: create)")
        return

    resp = requests.post(
        f"{BASE_URL}/api/chat",
        headers=headers(),
        json={"sessionId": session_id, "message": message},
        stream=True,
    )

    if resp.status_code == 401:
        print(f"认证失败: {resp.text}")
        return
    elif resp.status_code != 200:
        print(f"请求失败 [{resp.status_code}]: {resp.text}")
        return

    print("─" * 40)
    print("Assistant:", end=" ", flush=True)

    full_content = ""
    for line in resp.iter_lines():
        if not line:
            continue
        line = line.decode("utf-8")
        if line.startswith("event: message"):
            continue
        if line.startswith("data: "):
            data_str = line[6:]
            try:
                data = json.loads(data_str)
                content = data.get("content", "")
                done = data.get("done", False)
                if content:
                    print(content, end="", flush=True)
                    full_content += content
                if done:
                    print()  # 换行
            except json.JSONDecodeError:
                pass


def cmd_info():
    """查看会话信息"""
    if not session_id or not session_token:
        print("请先创建会话 (command: create)")
        return

    resp = requests.get(f"{BASE_URL}/api/session/{session_id}", headers=headers())
    if resp.status_code != 200:
        print(f"获取失败: {resp.text}")
        return

    data = resp.json()
    print(f"Session ID: {data['id']}")
    print(f"消息数: {data['messageCount']}")
    print(f"创建时间: {data['createdAt']}")
    print(f"更新时间: {data['updatedAt']}")


def cmd_messages():
    """获取完整消息上下文"""
    if not session_id or not session_token:
        print("请先创建会话 (command: create)")
        return

    resp = requests.get(f"{BASE_URL}/api/session/{session_id}/messages", headers=headers())
    if resp.status_code != 200:
        print(f"获取失败: {resp.text}")
        return

    data = resp.json()
    print(f"Session ID: {data['id']}")
    print(f"消息数: {len(data['messages'])}")
    print()
    for i, msg in enumerate(data["messages"]):
        role = msg["role"].upper()
        content = msg["content"]
        # 显示前100字符
        preview = content[:100] + "..." if len(content) > 100 else content
        print(f"[{i}] {role}: {preview}")


def cmd_export():
    """导出会话"""
    if not session_id or not session_token:
        print("请先创建会话 (command: create)")
        return

    resp = requests.get(f"{BASE_URL}/api/session/export/{session_id}", headers=headers())
    if resp.status_code != 200:
        print(f"导出失败: {resp.text}")
        return

    filename = f"session-{session_id}.json"
    with open(filename, "w", encoding="utf-8") as f:
        f.write(resp.text)
    print(f"✓ 已导出到 {filename}")


def cmd_import(path: str):
    """导入会话"""
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f"文件不存在: {path}")
        return
    except json.JSONDecodeError:
        print(f"无效的 JSON 文件: {path}")
        return

    resp = requests.post(
        f"{BASE_URL}/api/session/import",
        headers={"Content-Type": "application/json"},
        json={"messages": data.get("messages", [])},
    )

    if resp.status_code != 201:
        print(f"导入失败: {resp.text}")
        return

    result = resp.json()
    global session_id, session_token
    session_id = result["id"]
    session_token = result["token"]
    print(f"✓ 导入成功")
    print(f"  新 Session ID: {session_id}")
    print(f"  新 Token: {session_token}")
    print(f"  消息数: {result['messageCount']}")


def cmd_status():
    """当前会话状态"""
    if not session_id or not session_token:
        print("未连接会话")
    else:
        print(f"Session ID: {session_id}")
        print(f"Token: {session_token}")


def cmd_help():
    """帮助信息"""
    print("""
EnderRealm Assistant Agent - 测试脚本

命令:
  create              创建新会话
  chat <message>      发送消息
  info                查看会话信息
  messages            查看消息列表
  export              导出会话到文件
  import <path>       从文件导入会话
  status              查看当前会话状态
  help                显示帮助

示例:
  python test-chat.py create
  python test-chat.py chat 你好
  python test-chat.py info
  python test-chat.py messages
  python test-chat.py export
  python test-chat.py import session-xxx.json

快捷命令:
  直接输入文字发送消息
  直接输入 q 退出
""")


def main():
    if len(sys.argv) < 2:
        # 交互模式
        print("EnderRealm Assistant Agent - 交互模式")
        print("输入 q 退出，输入 help 查看帮助")
        cmd_help()

        while True:
            try:
                cmd = input("\n> ").strip()
            except (EOFError, KeyboardInterrupt):
                print("\n退出")
                break

            if not cmd:
                continue

            if cmd.lower() == "q":
                print("退出")
                break

            if cmd.lower() == "help":
                cmd_help()
                continue

            if cmd.lower() == "create":
                cmd_create()
                continue

            if cmd.lower() == "info":
                cmd_info()
                continue

            if cmd.lower() == "messages":
                cmd_messages()
                continue

            if cmd.lower() == "export":
                cmd_export()
                continue

            if cmd.lower() == "status":
                cmd_status()
                continue

            if cmd.lower().startswith("import "):
                path = cmd[7:].strip()
                cmd_import(path)
                continue

            if cmd.lower() == "chat":
                print("用法: chat <message>")
                continue

            # 其他情况当作用户消息发送
            cmd_chat(cmd)
    else:
        # 单命令模式
        cmd = sys.argv[1].lower()

        if cmd == "create":
            cmd_create()
        elif cmd == "info":
            cmd_info()
        elif cmd == "messages":
            cmd_messages()
        elif cmd == "export":
            cmd_export()
        elif cmd == "status":
            cmd_status()
        elif cmd == "help":
            cmd_help()
        elif cmd == "chat":
            if len(sys.argv) < 3:
                print("用法: chat <message>")
            else:
                cmd_chat(" ".join(sys.argv[2:]))
        elif cmd.startswith("import "):
            path = cmd[7:].strip()
            if not path and len(sys.argv) >= 3:
                path = sys.argv[2]
            cmd_import(path)
        else:
            # 当作用户消息
            cmd_chat(" ".join(sys.argv[1:]))


if __name__ == "__main__":
    main()