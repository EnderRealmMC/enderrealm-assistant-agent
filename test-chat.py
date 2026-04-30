#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
EnderRealm Assistant Agent - 测试脚本
支持创建会话、聊天、获取上下文、导出/导入等操作
"""

import json
import sys
import io
from typing import Optional

# Fix Windows console encoding issues
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

try:
    import requests
except ImportError:
    print("please install requests: pip install requests")
    sys.exit(1)

BASE_URL = "http://localhost:8787"
SESSION_FILE = ".session.json"

session_id: Optional[str] = None
session_token: Optional[str] = None


def load_session():
    """Load session from file"""
    global session_id, session_token
    try:
        with open(SESSION_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            session_id = data.get("id")
            session_token = data.get("token")
    except (FileNotFoundError, json.JSONDecodeError):
        pass


def save_session():
    """Save session to file"""
    if session_id and session_token:
        with open(SESSION_FILE, "w", encoding="utf-8") as f:
            json.dump({"id": session_id, "token": session_token}, f)


def clear_session():
    """Clear session file"""
    global session_id, session_token
    session_id = None
    session_token = None
    try:
        import os
        os.remove(SESSION_FILE)
    except FileNotFoundError:
        pass


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
        print(f"[FAIL] Create failed: {resp.text}")
        return

    data = resp.json()
    session_id = data["id"]
    session_token = data["token"]
    save_session()
    print(f"[OK] Session created")
    print(f"  ID:    {session_id}")
    print(f"  Token: {session_token}")


def cmd_chat(message: str):
    """发送消息"""
    if not session_id or not session_token:
        print("[FAIL] Please create session first (command: create)")
        return

    resp = requests.post(
        f"{BASE_URL}/api/chat",
        headers=headers(),
        json={"sessionId": session_id, "message": message},
    )

    if resp.status_code == 401:
        print(f"[FAIL] Auth failed: {resp.text}")
        return
    elif resp.status_code != 200:
        print(f"[FAIL] Request failed [{resp.status_code}]: {resp.text}")
        return

    print("-" * 40)
    print("Assistant:", end=" ", flush=True)

    # Use raw bytes and decode as UTF-8 to avoid encoding issues
    text = resp.content.decode("utf-8", errors="replace")

    # Parse SSE lines
    lines = text.split("\n")
    buffer = ""

    for line in lines:
        if line.startswith("data: "):
            data_str = line[6:].strip()
            if data_str == "[DONE]":
                break
            try:
                data = json.loads(data_str)
                content = data.get("content", "")
                if content:
                    buffer += content
            except json.JSONDecodeError:
                pass

    print(buffer)
    print()


def cmd_info():
    """查看会话信息"""
    if not session_id or not session_token:
        print("[FAIL] Please create session first (command: create)")
        return

    resp = requests.get(f"{BASE_URL}/api/session/{session_id}", headers=headers())
    if resp.status_code != 200:
        print(f"[FAIL] Get failed: {resp.text}")
        return

    data = resp.json()
    print(f"Session ID: {data['id']}")
    print(f"Messages:   {data['messageCount']}")
    print(f"Created:   {data['createdAt']}")
    print(f"Updated:   {data['updatedAt']}")


def cmd_messages():
    """获取完整消息上下文"""
    if not session_id or not session_token:
        print("[FAIL] Please create session first (command: create)")
        return

    resp = requests.get(f"{BASE_URL}/api/session/{session_id}/messages", headers=headers())
    if resp.status_code != 200:
        print(f"[FAIL] Get failed: {resp.text}")
        return

    data = resp.json()
    print(f"Session ID: {data['id']}")
    print(f"Messages:   {len(data['messages'])}")
    print()
    for i, msg in enumerate(data["messages"]):
        role = msg["role"].upper()
        content = msg["content"]
        preview = content[:100] + "..." if len(content) > 100 else content
        print(f"[{i}] {role}: {preview}")


def cmd_export():
    """导出会话"""
    if not session_id or not session_token:
        print("[FAIL] Please create session first (command: create)")
        return

    resp = requests.get(f"{BASE_URL}/api/session/export/{session_id}", headers=headers())
    if resp.status_code != 200:
        print(f"[FAIL] Export failed: {resp.text}")
        return

    filename = f"session-{session_id}.json"
    with open(filename, "w", encoding="utf-8") as f:
        f.write(resp.text)
    print(f"[OK] Exported to {filename}")


def cmd_import(path: str):
    """导入会话"""
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f"[FAIL] File not found: {path}")
        return
    except json.JSONDecodeError:
        print(f"[FAIL] Invalid JSON file: {path}")
        return

    resp = requests.post(
        f"{BASE_URL}/api/session/import",
        headers={"Content-Type": "application/json"},
        json={"messages": data.get("messages", [])},
    )

    if resp.status_code != 201:
        print(f"[FAIL] Import failed: {resp.text}")
        return

    result = resp.json()
    global session_id, session_token
    session_id = result["id"]
    session_token = result["token"]
    save_session()
    print(f"[OK] Import successful")
    print(f"  New ID:    {session_id}")
    print(f"  New Token: {session_token}")
    print(f"  Messages:  {result['messageCount']}")


def cmd_status():
    """当前会话状态"""
    if not session_id or not session_token:
        print("[INFO] No active session")
    else:
        print(f"Session ID: {session_id}")
        print(f"Token:      {session_token}")


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
    global session_id, session_token

    # Load existing session from file
    load_session()

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

            if cmd.lower() == "new":
                clear_session()
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

        if cmd.lower() == "create":
            cmd_create()
        elif cmd.lower() == "new":
            clear_session()
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