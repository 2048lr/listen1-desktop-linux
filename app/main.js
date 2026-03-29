// 导入所需的Electron模块和其他依赖
const electron = require("electron");
const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  session,
  screen,
  Tray,
} = electron;
const Store = require("electron-store");
const { autoUpdater } = require("electron-updater");
const remoteMain = require("@electron/remote/main");
const { join } = require("path");

// 初始化存储和图标路径
const store = new Store();
const iconPath = join(__dirname, "/listen1_chrome_extension/images/logo.png");

// 检查并通知更新
autoUpdater.checkForUpdatesAndNotify();

// 全局变量声明
let floatingWindowCssKey = undefined,  // 悬浮窗口CSS样式键
  appIcon = null,                      // 应用图标
  willQuitApp = false,                 // 是否要退出应用
  transparent = false,                 // 窗口是否透明
  trayIconPath;                        // 托盘图标路径

/** @type {electron.BrowserWindow} */
let mainWindow;                        // 主窗口

/** @type {electron.BrowserWindow} */
let floatingWindow;                    // 歌词悬浮窗口

/** @type {electron.Tray} */
let appTray;                           // 系统托盘

// 平台特定配置
switch (process.platform) {
  case "darwin":                       // macOS
    trayIconPath = join(__dirname, "/resources/logo_16.png");
    transparent = true;                // macOS支持透明窗口
    break;
  case "linux":                        // Linux
    trayIconPath = join(__dirname, "/resources/logo_32.png");
    // 修复Linux透明窗口不工作的bug
    app.disableHardwareAcceleration();
    break;
  case "win32":                        // Windows
    trayIconPath = join(__dirname, "/resources/logo_32.png");
    break;
  default:
    break;
}

// 保持窗口对象的全局引用，如果不这样做，窗口会在JavaScript对象被垃圾回收时自动关闭
/** @type {{ width: number; height: number; maximized: boolean; zoomLevel: number}} */
const windowState = store.get("windowState") || {
  width: 1000,
  height: 670,
  maximized: false,
  zoomLevel: 0,
};

/** @type {electron.Config} */
let proxyConfig = store.get("proxyConfig") || {
  mode: "system",
};

// 全局快捷键映射
const globalShortcutMapping = {
  "CmdOrCtrl+Alt+Left": "left",       // 上一首
  "CmdOrCtrl+Alt+Right": "right",     // 下一首
  "CmdOrCtrl+Alt+Space": "space",     // 播放/暂停
  MediaNextTrack: "right",             // 媒体下一首
  MediaPreviousTrack: "left",          // 媒体上一首
  MediaPlayPause: "space",             // 媒体播放/暂停
};

/**
 * 初始化系统托盘
 * @param {electron.BrowserWindow} mainWindow - 主窗口
 * @param {{ title: string; artist: string; }} [track] - 当前播放的歌曲信息
 */
function initialTray(mainWindow, track) {
  // 如果没有提供歌曲信息，使用默认值
  track ||= {
    title: "暂无歌曲",
    artist: "  ",
  };

  // 格式化当前播放信息
  let nowPlayingTitle = `${track.title}`;
  let nowPlayingArtist = `歌手: ${track.artist}`;

  // 切换窗口显示/隐藏
  function toggleVisiable() {
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  }

  // 托盘菜单模板
  const menuTemplate = [
    {
      label: nowPlayingTitle,          // 歌曲标题
      click() {
        mainWindow.show();             // 点击显示主窗口
      },
    },
    {
      label: nowPlayingArtist,          // 歌手信息
      click() {
        mainWindow.show();             // 点击显示主窗口
      },
    },
    { type: "separator" },              // 分隔线
    {
      label: "播放/暂停",
      click() {
        // 发送播放/暂停快捷键信号
        mainWindow.webContents.send("globalShortcut", "space");
      },
    },
    {
      label: "上一首",
      click() {
        // 发送上一首快捷键信号
        mainWindow.webContents.send("globalShortcut", "left");
      },
    },
    {
      label: "下一首",
      click() {
        // 发送下一首快捷键信号
        mainWindow.webContents.send("globalShortcut", "right");
      },
    },
    {
      label: "显示/隐藏窗口",
      click() {
        toggleVisiable();              // 切换窗口显示状态
      },
    },
    {
      label: "退出",
      click() {
        app.quit();                    // 退出应用
      },
    },
  ];

  // 构建上下文菜单
  const contextMenu = Menu.buildFromTemplate(menuTemplate);

  // 如果托盘已存在，只刷新菜单
  if (appTray?.destroy != undefined) {
    appTray?.setContextMenu(contextMenu);
    return;
  }

  // 创建新的系统托盘
  appTray = new Tray(trayIconPath);
  appTray.setContextMenu(contextMenu);
  // 托盘点击事件
  appTray.on("click", () => {
    toggleVisiable();
  });
}

/**
 * 设置快捷键映射
 * @param {string | electron.Accelerator} key - 快捷键
 * @param {string} message - 对应的操作消息
 */
function setKeyMapping(key, message) {
  globalShortcut.register(key, () => {
    // 注册全局快捷键，触发时发送相应消息
    mainWindow.webContents.send("globalShortcut", message);
  });
}

/**
 * 启用全局快捷键
 */
function enableGlobalShortcuts() {
  // 初始化全局快捷键
  for (const [key, value] of Object.entries(globalShortcutMapping)) {
    setKeyMapping(key, value);
  }
}

/**
 * 禁用全局快捷键
 */
function disableGlobalShortcuts() {
  globalShortcut.unregisterAll();
}

/**
 * 更新悬浮窗口样式
 * @param {string} cssStyle - CSS样式字符串
 */
async function updateFloatingWindow(cssStyle) {
  if (cssStyle === undefined) {
    return;
  }
  try {
    // 插入新的CSS样式
    const newCssKey = await floatingWindow.webContents.insertCSS(cssStyle, {
      cssOrigin: "author",
    });
    // 如果已有样式，先移除
    if (floatingWindowCssKey !== undefined) {
      await floatingWindow.webContents.removeInsertedCSS(floatingWindowCssKey);
    }
    floatingWindowCssKey = newCssKey;
  } catch (err) {
    console.log(err);
  }
}

/**
 * 更新代理配置
 * @param {electron.Config} params - 代理配置参数
 */
async function updateProxyConfig(params) {
  proxyConfig = params;

  // 设置代理配置并强制重新加载
  await mainWindow.webContents.session.setProxy(params);
  await mainWindow.webContents.session.forceReloadProxyConfig();
}

/**
 * 创建歌词悬浮窗口
 * @param {string} cssStyle - CSS样式字符串
 */
function createFloatingWindow(cssStyle) {
  const display = screen.getPrimaryDisplay();
  
  // Linux平台特殊处理透明窗口
  if (process.platform === "linux") {
    // 修复Linux透明窗口不工作的bug
    floatingWindow?.destroy();
    floatingWindow = null;
  }
  
  // 如果悬浮窗口不存在，创建新窗口
  if (!floatingWindow) {
    /** @type {Electron.Rectangle} */
    const winBounds = store.get("floatingWindowBounds");

    // 创建悬浮窗口
    floatingWindow = new BrowserWindow({
      width: 1000,                     // 窗口宽度
      minWidth: 640,                   // 最小宽度
      maxWidth: 1920,                  // 最大宽度
      height: 70,                      // 窗口高度
      titleBarStyle: "hidden",         // 隐藏标题栏
      transparent: true,                // 透明背景
      frame: false,                    // 无边框
      resizable: true,                 // 可调整大小
      hasShadow: false,                // 无阴影
      alwaysOnTop: true,               // 始终置顶
      webPreferences: {
        sandbox: true,                 // 启用沙盒
        preload: join(__dirname, "preload.js"), // 预加载脚本
      },
      ...winBounds,                    // 恢复之前的位置和大小
    });

    // 如果没有保存的位置，设置默认位置
    if (winBounds === undefined) {
      floatingWindow.setPosition(
        floatingWindow.getPosition()[0],
        display.bounds.height - 150    // 屏幕底部向上150像素
      );
    }
    
    // 窗口属性设置
    floatingWindow.setVisibleOnAllWorkspaces(true);    // 在所有工作区可见
    floatingWindow.setSkipTaskbar(true);               // 不在任务栏显示
    floatingWindow.loadURL(`file://${__dirname}/floatingWindow.html`); // 加载悬浮窗口页面
    floatingWindow.setAlwaysOnTop(true, "floating");   // 置顶
    floatingWindow.setIgnoreMouseEvents(false);        // 不忽略鼠标事件
    
    // 页面加载完成后更新样式
    floatingWindow.webContents.on("did-finish-load", async () => {
      await updateFloatingWindow(cssStyle);
    });
    
    // 窗口关闭事件
    floatingWindow.on("closed", () => {
      floatingWindow = null;
    });

    // 可选：打开开发者工具用于调试
    // floatingWindow.webContents.openDevTools();
  }
  
  // 显示窗口但不激活
  floatingWindow.showInactive();
}

// 任务栏缩略图按钮配置
const previousButton = {
  tooltip: "Previous",                 // 提示文本
  icon: join(__dirname, "/resources/prev-song.png"), // 图标路径
  click() {
    // 点击上一首
    mainWindow.webContents.send("globalShortcut", "left");
  },
};

const nextButton = {
  tooltip: "Next",
  icon: join(__dirname, "/resources/next-song.png"),
  click() {
    // 点击下一首
    mainWindow.webContents.send("globalShortcut", "right");
  },
};

const playButton = {
  tooltip: "Play",
  icon: join(__dirname, "/resources/play-song.png"),
  click() {
    // 点击播放
    mainWindow.webContents.send("globalShortcut", "space");
  },
};

const pauseButton = {
  tooltip: "Pause",
  icon: join(__dirname, "/resources/pause-song.png"),
  click() {
    // 点击暂停
    mainWindow.webContents.send("globalShortcut", "space");
  },
};

// 设置暂停状态的缩略图按钮
const setThumbarPause = () => {
  mainWindow?.setThumbarButtons([previousButton, playButton, nextButton]);
};

// 设置播放状态的缩略图按钮
const setThumbbarPlay = () => {
  mainWindow?.setThumbarButtons([previousButton, pauseButton, nextButton]);
};

/**
 * 创建主窗口
 */
function createWindow() {
  // 定义需要修改请求头的URL过滤器
  const filter = {
    urls: [
      /*"*://*.music.163.com/*",
      "*://music.163.com/*",*/
      "*://*.xiami.com/*",              // 虾米音乐
      "*://*.kugou.com/*",              // 酷狗音乐
      "*://*.bilibili.com/*",           // B站
      "*://*.bilivideo.com/*",          // B站视频
      "*://*.bilivideo.cn/*",           // B站视频
      "*://*.githubusercontent.com/*",  // GitHub内容
      "https://listen1.github.io/listen1/callback.html?code=*", // GitHub回调
    ],
  };

  // 监听发送请求前的事件，修改请求头
  session.defaultSession.webRequest.onBeforeSendHeaders(
    filter,
    (details, callback) => {
      // 处理GitHub回调
      if (
        details.url.startsWith(
          "https://listen1.github.io/listen1/callback.html?code="
        )
      ) {
        const { url } = details;
        const code = url.split("=")[1];
        // 执行JavaScript处理回调
        mainWindow.webContents.executeJavaScript(
          'GithubClient.github.handleCallback("' + code + '");'
        );
      } else {
        // 修改其他请求的请求头
        hack_referer_header(details);
      }
      callback({ cancel: false, requestHeaders: details.requestHeaders });
    }
  );
  
  // 创建浏览器窗口
  mainWindow = new BrowserWindow({
    width: windowState.width,          // 窗口宽度
    height: windowState.height,        // 窗口高度
    minHeight: 300,                    // 最小高度
    minWidth: 600,                     // 最小宽度
    webPreferences: {
      nodeIntegration: true,           // 启用Node.js集成
      enableRemoteModule: true,        // 启用远程模块
      contextIsolation: false,        // 禁用上下文隔离
    },
    icon: iconPath,                    // 窗口图标
    titleBarStyle: "hiddenInset",      // 隐藏标题栏（macOS风格）
    transparent: transparent,          // 透明背景
    vibrancy: "light",                 // 毛玻璃效果（macOS）
    frame: false,                      // 无边框
    hasShadow: true,                   // 有阴影
  });

  // 窗口准备显示时的回调
  mainWindow.on("ready-to-show", () => {
    if (windowState.maximized) {
      mainWindow.maximize();           // 如果之前是最大化状态，恢复最大化
    }
    // 设置缩放级别
    mainWindow.webContents.send("setZoomLevel", windowState.zoomLevel);
  });

  // 窗口大小改变时的回调
  mainWindow.on("resized", () => {
    // 如果不是最大化或全屏状态，保存窗口大小
    if (!mainWindow.isMaximized() && !mainWindow.isFullScreen()) {
      const [width, height] = mainWindow.getSize();
      windowState.width = width;
      windowState.height = height;
    }
  });
  
  // 窗口关闭事件
  mainWindow.on("close", (e) => {
    if (willQuitApp) {
      /* 用户尝试退出应用 */
      mainWindow = null;
    } else {
      /* 用户只是尝试关闭窗口 */
      //if (process.platform != 'linux') {
      e.preventDefault();              // 阻止默认关闭行为
      mainWindow.hide();               // 隐藏窗口而不是关闭
      //mainWindow.minimize();
      //}
    }
  });

  // 设置用户代理字符串
  const ua =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/72.0.3626.119 Safari/537.36";

  // 设置代理后加载主页面
  mainWindow.webContents.session.setProxy(proxyConfig).then(() => {
    mainWindow.loadURL(
      `file://${__dirname}/listen1_chrome_extension/listen1.html`,
      { userAgent: ua }                // 使用自定义用户代理
    );
  });

  // 设置初始缩略图按钮状态
  setThumbarPause();
  
  // 窗口关闭事件
  mainWindow.on("closed", () => {
    // 取消窗口引用，如果应用支持多窗口，通常会将窗口存储在数组中
    mainWindow = null;
  });

  // 定义全局菜单内容，同时支持cmd+c和cmd+v快捷键
  const template = [
    {
      label: "Application",            // 应用菜单
      submenu: [
        {
          label: "Zoom Out",           // 缩小
          accelerator: "CmdOrCtrl+=",  // 快捷键
          click() {
            // 放大功能（标签是Zoom Out但实际是放大）
            if (windowState.zoomLevel <= 2.5) {
              windowState.zoomLevel += 0.5;
              mainWindow.webContents.send(
                "setZoomLevel",
                windowState.zoomLevel
              );
            }
          },
        },
        {
          label: "Zoom in",            // 放大（标签是Zoom in但实际是缩小）
          accelerator: "CmdOrCtrl+-",  // 快捷键
          click() {
            if (windowState.zoomLevel >= -1) {
              windowState.zoomLevel -= 0.5;
              mainWindow.webContents.send(
                "setZoomLevel",
                windowState.zoomLevel
              );
            }
          },
        },
        {
          label: "Toggle Developer Tools", // 切换开发者工具
          accelerator: "F12",           // F12快捷键
          click() {
            mainWindow.webContents.toggleDevTools(); // 切换开发者工具
          },
        },
        {
          label: "About Application",  // 关于应用
          selector: "orderFrontStandardAboutPanel:", // macOS标准关于面板
        },
        { type: "separator" },         // 分隔线
        {
          label: "Close Window",       // 关闭窗口
          accelerator: "CmdOrCtrl+W",   // 快捷键
          click() {
            mainWindow.close();        // 关闭窗口
          },
        },
        {
          label: "Quit",               // 退出应用
          accelerator: "Command+Q",    // macOS退出快捷键
          click() {
            app.quit();               // 退出应用
          },
        },
      ],
    },
    {
      label: "Edit",                   // 编辑菜单
      submenu: [
        { label: "Undo", accelerator: "CmdOrCtrl+Z", selector: "undo:" },     // 撤销
        { label: "Redo", accelerator: "Shift+CmdOrCtrl+Z", selector: "redo:" }, // 重做
        { type: "separator" },         // 分隔线
        { label: "Cut", accelerator: "CmdOrCtrl+X", selector: "cut:" },       // 剪切
        { label: "Copy", accelerator: "CmdOrCtrl+C", selector: "copy:" },     // 复制
        { label: "Paste", accelerator: "CmdOrCtrl+V", selector: "paste:" },   // 粘贴
        {
          label: "Select All",        // 全选
          accelerator: "CmdOrCtrl+A",  // 快捷键
          selector: "selectAll:",      // 选择器
        },
      ],
    },
  ];

  // 设置窗口菜单
  mainWindow.setMenu(null);
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  // 初始化系统托盘
  initialTray(mainWindow);
}

// 移动端用户代理字符串
const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 14_3 like Mac OS X) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30";

/**
 * 修改请求头以绕过某些网站的限制
 * @param {electron.OnBeforeSendHeadersListenerDetails} details - 请求详情
 */
function hack_referer_header(details) {
  let replace_referer = true;          // 是否替换Referer
  let replace_origin = true;           // 是否替换Origin
  let add_referer = true;              // 是否添加Referer
  let add_origin = true;               // 是否添加Origin
  let referer_value = "";              // Referer值
  let origin_value = "";               // Origin值
  let ua_value = "";                   // 用户代理值

  // 根据URL设置不同的请求头值
  /*if (details.url.includes("://music.163.com/")) {
    referer_value = "http://music.163.com/";
  }
  if (details.url.includes("://interface3.music.163.com/")) {
    referer_value = "http://music.163.com/";
  }*/
  
  // GitHub Gist
  if (details.url.includes("://gist.githubusercontent.com/")) {
    referer_value = "https://gist.githubusercontent.com/";
  }

  // 虾米音乐
  if (details.url.includes(".xiami.com/")) {
    add_origin = false;
    referer_value = "https://www.xiami.com/";
  }
  if (details.url.includes("www.xiami.com/api/search/searchSongs")) {
    const key = /key%22:%22(.*?)%22/.exec(details.url)[1];
    add_origin = false;
    referer_value = `https://www.xiami.com/search?key=${key}`;
  }
  
  // 酷狗音乐
  if (details.url.includes(".kugou.com/")) {
    referer_value = "https://www.kugou.com/";
    ua_value = MOBILE_UA;              // 使用移动端用户代理
  }
  if (details.url.includes("m.kugou.com/")) {
    ua_value = MOBILE_UA;
  }
  
  // B站
  if (
    details.url.includes(".bilibili.com/") ||
    details.url.includes(".bilivideo.com/")
  ) {
    referer_value = "https://www.bilibili.com/";
    replace_origin = false;
    add_origin = false;
  }
  if (details.url.includes('.bilivideo.cn')) {
    referer_value = 'https://www.bilibili.com/';
    origin_value = 'https://www.bilibili.com/';
    add_referer = true;
    add_origin = true;
  }
  
  // 如果Origin值为空，使用Referer值
  if (origin_value == "") {
    origin_value = referer_value;
  }
  
  // 标记是否已设置各个头部
  let isRefererSet = false;
  let isOriginSet = false;
  let isUASet = false;
  let headers = details.requestHeaders;

  // 遍历现有头部进行替换
  for (let i = 0, l = headers.length; i < l; ++i) {
    if (
      replace_referer &&
      headers[i].name == "Referer" &&
      referer_value != ""
    ) {
      headers[i].value = referer_value;
      isRefererSet = true;
    }
    if (replace_origin && headers[i].name == "Origin" && referer_value != "") {
      headers[i].value = origin_value;
      isOriginSet = true;
    }
    if (headers[i].name === "User-Agent" && ua_value !== "") {
      headers[i].value = ua_value;
      isUASet = true;
    }
  }

  // 如果需要添加Referer但未设置
  if (add_referer && !isRefererSet && referer_value != "") {
    headers["Referer"] = referer_value;
  }

  // 如果需要添加Origin但未设置
  if (add_origin && !isOriginSet && referer_value != "") {
    headers["Origin"] = origin_value;
  }

  // 如果需要设置用户代理但未设置
  if (!isUASet && ua_value !== "") {
    headers["User-Agent"] = ua_value;
  }

  // 更新请求头
  details.requestHeaders = headers;
}

// IPC主进程事件监听

// 当前歌词事件
ipcMain.on("currentLyric", (event, arg) => {
  if (floatingWindow && floatingWindow !== null) {
    if (typeof arg === "string") {
      // 发送歌词到悬浮窗口
      floatingWindow.webContents.send("currentLyric", arg);
      floatingWindow.webContents.send("currentLyricTrans", "");
    } else {
      // 发送歌词和翻译歌词
      floatingWindow.webContents.send("currentLyric", arg.lyric);
      floatingWindow.webContents.send("currentLyricTrans", arg.tlyric);
    }
  }
});

// 当前播放歌曲事件
ipcMain.on("trackPlayingNow", (event, track) => {
  if (mainWindow != null) {
    // 更新托盘显示的歌曲信息
    initialTray(mainWindow, track);
  }
});

// 播放状态事件
ipcMain.on("isPlaying", (event, isPlaying) => {
  // 根据播放状态更新缩略图按钮
  isPlaying ? setThumbbarPlay() : setThumbarPause();
});

// 控制事件处理
ipcMain.on("control", async (event, arg, params) => {
  switch (arg) {
    case "enable_global_shortcut":     // 启用全局快捷键
      enableGlobalShortcuts();
      break;

    case "disable_global_shortcut":    // 禁用全局快捷键
      disableGlobalShortcuts();
      break;

    case "enable_lyric_floating_window": // 启用歌词悬浮窗口
      createFloatingWindow(params);
      break;

    case "disable_lyric_floating_window": // 禁用歌词悬浮窗口
      floatingWindow?.hide();
      break;

    case "window_min":                 // 最小化窗口
      mainWindow.minimize();
      break;

    case "window_max":                 // 最大化/还原窗口
      windowState.maximized ? mainWindow.unmaximize() : mainWindow.maximize();
      windowState.maximized = !windowState.maximized;
      break;

    case "window_close":               // 关闭窗口
      mainWindow.close();
      break;

    case "float_window_accept_mouse_event": // 悬浮窗口接受鼠标事件
      floatingWindow.setIgnoreMouseEvents(false);
      break;

    case "float_window_ignore_mouse_event": // 悬浮窗口忽略鼠标事件
      floatingWindow.setIgnoreMouseEvents(true, { forward: true });
      break;

    case "float_window_close":         // 关闭悬浮窗口
    case "float_window_font_small":     // 悬浮窗口字体缩小
    case "float_window_font_large":     // 悬浮窗口字体放大
    case "float_window_background_light": // 悬浮窗口背景变亮
    case "float_window_background_dark":  // 悬浮窗口背景变暗
    case "float_window_font_change_color": // 悬浮窗口字体颜色改变
      // 发送歌词窗口控制消息
      mainWindow.webContents.send("lyricWindow", arg);
      break;

    case "update_lyric_floating_window_css": // 更新悬浮窗口CSS
      await updateFloatingWindow(params);
      break;

    case "get_proxy_config":           // 获取代理配置
      mainWindow.webContents.send("proxyConfig", proxyConfig);
      break;

    case "update_proxy_config":        // 更新代理配置
      await updateProxyConfig(params);
      break;

    default:
      break;
  }
});

// 打开URL事件
ipcMain.on("openUrl", (event, arg, params) => {
  // 创建新的浏览器窗口
  const bWindow = new BrowserWindow({
    parent: mainWindow,                // 父窗口
    height: 700,                       // 窗口高度
    resizable: true,                   // 可调整大小
    width: 985,                        // 窗口宽度
    frame: true,                       // 有边框
    fullscreen: false,                 // 不全屏
    maximizable: true,                 // 可最大化
    minimizable: true,                 // 可最小化
    autoHideMenuBar: true,             // 自动隐藏菜单栏
    webPreferences: {
      // 沙盒对网站JS工作是必要的
      sandbox: true,
    },
  });
  bWindow.loadURL(arg);                // 加载URL
  bWindow.setMenu(null);               // 不显示菜单
});

// 悬浮窗口移动事件
ipcMain.on("floatWindowMoving", (e, { mouseX, mouseY }) => {
  const { x, y } = screen.getCursorScreenPoint(); // 获取鼠标位置
  // 设置悬浮窗口位置
  floatingWindow?.setPosition(x - mouseX, y - mouseY);
});

// 应用单实例锁
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // 如果无法获取锁，说明已有实例运行，退出当前实例
  app.quit();
} else {
  // 第二个实例启动时的处理
  app.on("second-instance", (event, commandLine, workingDirectory) => {
    // 有人尝试运行第二个实例，我们应该聚焦我们的窗口
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore(); // 如果最小化则恢复
      mainWindow.focus();                                // 聚焦窗口
      // 启动新实例时，显示主窗口并在任务栏激活
      mainWindow.show();
      mainWindow.setSkipTaskbar(false);
    }
  });

  // 应用准备就绪时的处理
  app.on("ready", () => {
    createWindow();                    // 创建窗口
    remoteMain.initialize();           // 初始化远程模块
    remoteMain.enable(mainWindow.webContents); // 启用远程模块
  });
}

// 所有窗口关闭时的处理
app.on("window-all-closed", () => {
  // 在macOS上，应用和菜单栏通常保持活动状态，直到用户明确退出
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// 激活事件（macOS Dock图标点击）
app.on("activate", () => mainWindow.show());

// 退出前的处理
app.on("before-quit", () => {
  // 关闭开发者工具
  if (mainWindow.webContents.isDevToolsOpened()) {
    mainWindow.webContents.closeDevTools();
  }
  
  // 保存悬浮窗口位置和大小
  if (floatingWindow) {
    store.set("floatingWindowBounds", floatingWindow.getBounds());
  }
  
  // 保存窗口状态和代理配置
  store.set("windowState", windowState);
  store.set("proxyConfig", proxyConfig);

  willQuitApp = true;                  // 标记为要退出应用
});

// 退出时的处理
app.on("will-quit", () => {
  disableGlobalShortcuts();            // 禁用全局快捷键
});