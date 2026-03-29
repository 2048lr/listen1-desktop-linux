# Listen 1 音乐播放器（Linux桌面版）

本项目的大部分代码来自于 [listen1\_desktop](https://github.com/listen1/listen1_desktop) 项目，感谢母项目作者的默默付出。本人根据 License 中的 MIT 协议，对原来的项目进行修改。

## 关于本项目

自己是一个刚刚入坑 Ubuntu 24.04 LTS 的学生。在被 AppImage 包折磨之后，根据原始代码，加上修改，打包成 deb 和 rpm。大部分代码与原项目无区别，部分代码由 AI 完成修改。本项目只有 Linux x86\_64 的 deb 和 rpm 包。

## 支持音乐平台

- ❓ 网易云音乐（未测试）
- ❌ QQ 音乐
- ✅ 酷狗音乐
- ❌ 酷我音乐
- ✅ bilibili
- ❌ 咪咕音乐
- ✅ 千千音乐

由于平台声明涉及版权原因，本安装包已经移除了 QQ 音乐、酷我音乐、咪咕音乐。网易云音乐未测试。

[!\[imgur\](http://i.imgur.com/Ae6ItmA.png null)]()

## 安装方式

1. 若您需要 Linux 通用包（Appimage）、macOS、Windows、安卓安装包，请访问 <https://listen1.github.io/listen1>
2. 若您需要 deb 和 rpm 包，请访问本项目的 release 页面

### 安装方法

下载本安装包，根据系统，输入：

1. Debian、Ubuntu：
   ```
   sudo apt install ./listen1_linux_x86_64.deb
   ```
2. Fedora 等以 RPM 管理安装软件的系统：
   ```
   sudo dnf install ./listen1_linux_x86_64.rpm
   ```

