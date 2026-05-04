// download-functions.test.js - 下载功能专项测试
import { EventEmitter } from 'events'

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

// Create a proper mock file stream using EventEmitter
class MockWriteStream extends EventEmitter {
  constructor() {
    super()
    this.writable = true
  }

  write(chunk) {
    return true
  }

  end() {
    // Simulate successful completion
    setTimeout(() => {
      this.emit('finish')
    }, 50)
  }

  close() {
    this.emit('close')
  }
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
      existsSync: () => false,
      mkdirSync: () => {},
      rmSync: () => {},
      createWriteStream: () => new MockWriteStream(),
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

console.log('🧪 开始运行下载功能专项测试...\n')

// Test 1: 小文件下载测试 - 验证下载功能基本工作
console.log('📥 测试 1: 小文件下载功能')
try {
  const progressUpdates = []

  // 使用一个小的测试文件进行真实下载测试
  const testUrl = 'https://httpbin.org/bytes/1024' // 1KB 测试文件
  const testPath = '/tmp/test-download.bin'

  const progressCallback = (progress) => {
    progressUpdates.push(progress)
    console.log(`   下载进度: ${Math.round(progress * 100)}%`)
  }

  await comfyUIInstaller.downloadFile(testUrl, testPath, progressCallback)

  if (progressUpdates.length > 0) {
    console.log('✅ 小文件下载测试通过')
    console.log(`   收到 ${progressUpdates.length} 个进度更新`)
  } else {
    console.log('❌ 小文件下载测试失败: 没有收到进度更新')
  }
} catch (error) {
  console.log('❌ 小文件下载测试失败:', error.message)
}

console.log()

// Test 2: 下载取消测试 - 验证取消机制
console.log('🛑 测试 2: 下载取消功能')
try {
  // 重置取消状态
  comfyUIInstaller.resetCancellationState()

  // 开始一个下载，然后立即取消
  const downloadPromise = comfyUIInstaller.downloadFile(
    'https://httpbin.org/delay/3', // 3秒延迟的请求
    '/tmp/test-cancel.bin',
    () => {}
  )

  // 立即取消
  setTimeout(() => {
    comfyUIInstaller.cancelInstallation()
  }, 100)

  try {
    await downloadPromise
    console.log('❌ 下载取消测试失败: 下载应该被取消')
  } catch (error) {
    if (error.message.includes('cancelled')) {
      console.log('✅ 下载取消测试通过')
    } else {
      console.log('❌ 下载取消测试失败:', error.message)
    }
  }
} catch (error) {
  console.log('❌ 下载取消测试失败:', error.message)
}

console.log()

// Test 3: 错误处理测试 - 验证错误处理机制
console.log('⚠️ 测试 3: 下载错误处理')
try {
  // 重置取消状态
  comfyUIInstaller.resetCancellationState()

  // 尝试下载一个不存在的文件
  await comfyUIInstaller.downloadFile(
    'https://httpbin.org/status/404', // 返回 404 错误
    '/tmp/test-error.bin',
    () => {}
  )

  console.log('❌ 错误处理测试失败: 应该抛出错误')
} catch (error) {
  if (
    error.message.includes('404') ||
    error.message.includes('Download failed')
  ) {
    console.log('✅ 错误处理测试通过')
  } else {
    console.log('❌ 错误处理测试失败:', error.message)
  }
}

console.log('\n🎉 下载功能测试完成！')
