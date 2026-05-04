// core-functions.test.js - ComfyUI 安装器核心功能测试
import path from 'path'

// Set up test environment
process.env.IS_WORKER_PROCESS = 'false'

// Mock electron modules
const mockElectron = {
  app: {
    getPath: () => '/mock/user/data',
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
}

// Mock modules
const Module = await import('module')
const originalRequire = Module.default.prototype.require

Module.default.prototype.require = function (id) {
  if (id === 'electron') {
    return mockElectron
  }
  if (id === 'child_process') {
    return { spawn: () => {} }
  }
  if (id === 'fs') {
    return {
      existsSync: (path) => {
        // 模拟文件存在的逻辑
        if (path.includes('ComfyUI_windows_portable')) return true
        if (path.includes('run_cpu.bat')) return true
        return false
      },
      mkdirSync: () => {},
      rmSync: () => {},
      createWriteStream: () => ({ close: () => {}, on: () => {} }),
      unlink: () => {},
      statSync: () => ({ size: 1000 }),
      unlinkSync: () => {},
    }
  }
  if (id === '7zip-min') {
    return { unpack: () => {} }
  }
  return originalRequire.call(this, id)
}

// Import the module
const comfyUIInstaller = await import('../../comfyUIInstaller.js')

console.log('🧪 开始运行 ComfyUI 核心功能测试...\n')

// Test 1: GitHub API - 最重要的测试
console.log('📡 测试 1: GitHub API 集成')
try {
  const result = await comfyUIInstaller.getLatestComfyUIRelease()
  console.log('✅ GitHub API 测试通过:')
  console.log(`   版本: ${result.version}`)
  console.log(`   文件名: ${result.fileName}`)
  console.log(`   大小: ${Math.round(result.size / 1024 / 1024)}MB`)
} catch (error) {
  console.log('❌ GitHub API 测试失败:', error.message)
}

console.log()

// Test 2: 安装状态管理 - 核心状态控制
console.log('🔄 测试 2: 安装状态管理')
try {
  // 初始状态应该是未取消
  if (!comfyUIInstaller.isInstallationCancelled()) {
    console.log('✅ 初始状态测试通过')
  } else {
    console.log('❌ 初始状态测试失败')
  }

  // 测试取消功能
  comfyUIInstaller.cancelInstallation()
  if (comfyUIInstaller.isInstallationCancelled()) {
    console.log('✅ 取消安装测试通过')
  } else {
    console.log('❌ 取消安装测试失败')
  }

  // 测试重置状态
  comfyUIInstaller.resetCancellationState()
  if (!comfyUIInstaller.isInstallationCancelled()) {
    console.log('✅ 重置状态测试通过')
  } else {
    console.log('❌ 重置状态测试失败')
  }
} catch (error) {
  console.log('❌ 安装状态管理测试失败:', error.message)
}

console.log()

// Test 3: 文件系统操作 - 基础文件查找
console.log('📁 测试 3: 文件系统操作')
try {
  const testDir = '/test/comfyui'

  // 测试查找主目录
  const mainDir = comfyUIInstaller.findComfyUIMainDir(testDir)
  if (mainDir === path.join(testDir, 'ComfyUI_windows_portable')) {
    console.log('✅ 查找主目录测试通过')
  } else {
    console.log('❌ 查找主目录测试失败')
  }

  // 测试查找运行脚本
  const runScript = comfyUIInstaller.findRunScript(testDir)
  if (runScript === path.join(testDir, 'run_cpu.bat')) {
    console.log('✅ 查找运行脚本测试通过')
  } else {
    console.log('❌ 查找运行脚本测试失败')
  }
} catch (error) {
  console.log('❌ 文件系统操作测试失败:', error.message)
}

console.log()

// Test 4: 配置管理 - 简化版本
console.log('⚙️ 测试 4: 配置管理')
try {
  // Mock fetch
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ message: 'Config updated successfully' }),
  })

  await comfyUIInstaller.updateConfigWithComfyUI()
  console.log('✅ 配置更新测试通过')
} catch (error) {
  console.log('❌ 配置更新测试失败:', error.message)
}

console.log('\n🎉 核心功能测试完成！')
