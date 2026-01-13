# <img src="assets/icon-small.png" width="32" height="32" alt="icon"> AntiBridge v1.2.0

**A bridge between you and Antigravity.**

Control your AI coding agent from any browser on the same network.  
🌐 **Remote Access:** Use [Tailscale](https://tailscale.com/) to access from anywhere outside your LAN!

![AntiBridge Logo](assets/Logo_AntiBridge.png)

## 🎬 Preview

![AntiBridge Demo](assets/preview.gif)

---

## ✨ Features

- 💬 **Real-time Chat** - Send commands and receive AI responses instantly
- 📝 **Markdown Rendering** - Code blocks, tables, lists with syntax highlighting
- 💾 **Chat History** - Your conversations persist across sessions
- 🔄 **Auto-reconnect** - Automatically reconnects when connection drops
- 🌓 **Dark Theme** - Easy on the eyes for long coding sessions
- 🌐 **Remote Access** - Use Tailscale for secure access from anywhere

---

## 🚀 Quick Start

### 1. First-time Setup
Double-click `SETUP.bat` to install dependencies (only needed once).

### 2. Start Antigravity with CDP
Double-click `OPEN_ANTIGRAVITY.vbs` - this opens Antigravity with remote debugging enabled.

### 3. Start Server
Double-click `START.bat` - this starts the AntiBridge server.

### 4. Open in Browser
- **Same PC:** http://localhost:8000
- **Other device on network:** http://YOUR_PC_IP:8000

To find your PC's IP address, open Command Prompt and run `ipconfig`.

---

## 🌐 Remote Access with Tailscale

Want to access AntiBridge from outside your home/office network? Use **Tailscale**!

### Setup Steps:

1. **Install Tailscale** on both devices:
   - PC running AntiBridge: https://tailscale.com/download/windows
   - Phone/Remote device: https://tailscale.com/download

2. **Login** with the same account on both devices

3. **Get Tailscale IP** of your PC:
   - Open Tailscale on PC
   - Note the IP (usually `100.x.x.x`)

4. **Access from anywhere:**
   ```
   http://100.x.x.x:8000
   ```

### Benefits:
- ✅ **Secure** - End-to-end encrypted connection
- ✅ **No port forwarding** - Works through NAT
- ✅ **Free tier** - 100 devices free
- ✅ **Works on mobile data** - Access from anywhere with internet

---

## 📋 Requirements

- **Node.js 18+** - [Download here](https://nodejs.org/)
- **Antigravity IDE** - Your AI coding agent
- **Windows 10/11**
- **Tailscale** (optional) - For remote access outside LAN

---

## 📁 Project Structure

```
AntiBridge_v1.2.0/
├── START.bat           # Start the server
├── SETUP.bat           # First-time setup
├── OPEN_ANTIGRAVITY.vbs # Open Antigravity with CDP
│
├── backend/            # Node.js server
│   ├── server.js       # Main server file
│   ├── routes/         # API endpoints
│   └── services/       # Business logic
│
├── frontend/           # Web interface
│   ├── index.html      # Main page
│   ├── css/            # Styles
│   └── js/             # JavaScript
│
├── scripts/            # Injection scripts
└── assets/             # Logo and icons
```

---

## 🔒 Security Notes

- **Local Network Only** - This tool is designed for use within your local network
- **No Internet Exposure** - Never expose port 8000 to the internet
- **Trusted Network** - No authentication is required (use on trusted networks only)

---

## 🛠 Troubleshooting

### Server won't start
- Make sure Node.js is installed: `node --version`
- Run `SETUP.bat` to install dependencies

### Can't connect from browser
- Check if server is running (look for the console window)
- Make sure firewall allows port 8000
- Try http://localhost:8000 first

### AI responses not showing
- Make sure Antigravity is running with CDP (use `OPEN_ANTIGRAVITY.vbs`)
- Check server console for CDP connection status

---

## 📄 License

MIT License

Copyright (c) 2026 Linh Ban Banh Bao

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.

---

## 👨‍💻 Author

**Linh Ban Banh Bao**  
🌐 [Facebook](https://www.facebook.com/linhbuiart.io.vn/)  
🔗 [GitHub](https://github.com/linhbanbanhbao/AntiBridge)

---

*AntiBridge - Making AI coding agents accessible from anywhere on your network.*
