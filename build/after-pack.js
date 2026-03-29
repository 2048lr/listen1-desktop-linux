const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

exports.default = async function(context) {
  if (context.packager.platform.nodeName === 'linux') {
    const appOutDir = context.appOutDir;
    const chromeSandbox = path.join(appOutDir, 'chrome-sandbox');
    
    console.log('Fixing chrome-sandbox permissions...');
    
    try {
      execSync(`chmod 4755 "${chromeSandbox}"`, { stdio: 'inherit' });
      console.log('chrome-sandbox permissions fixed successfully');
    } catch (error) {
      console.error('Failed to fix chrome-sandbox permissions:', error);
    }

    const localesDir = path.join(appOutDir, 'locales');
    if (fs.existsSync(localesDir)) {
      const keepLocales = ['zh-CN.pak', 'zh-TW.pak', 'en-US.pak'];
      const files = fs.readdirSync(localesDir);
      let removedCount = 0;
      
      files.forEach(file => {
        if (!keepLocales.includes(file)) {
          fs.unlinkSync(path.join(localesDir, file));
          removedCount++;
        }
      });
      console.log(`Removed ${removedCount} unnecessary locale files, kept ${keepLocales.join(', ')}`);
    }
  }
};
