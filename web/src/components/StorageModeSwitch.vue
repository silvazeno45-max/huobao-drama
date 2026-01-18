<script setup lang="ts">
import { ref, computed } from 'vue'
import { ElSwitch, ElCard, ElButton, ElMessageBox, ElMessage } from 'element-plus'
import { getStorageMode, setStorageMode, isLocalMode, type StorageMode } from '@/services/config'
import { exportAllData, importData, clearAllData } from '@/services/storage'

const currentMode = ref<StorageMode>(getStorageMode())
const isLocal = computed(() => currentMode.value === 'local')

const handleModeChange = (val: boolean) => {
  const newMode: StorageMode = val ? 'local' : 'api'
  
  ElMessageBox.confirm(
    `确定要切换到${val ? '本地存储' : 'API 服务'}模式吗？切换后页面将刷新。`,
    '切换存储模式',
    {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    }
  ).then(() => {
    setStorageMode(newMode)
  }).catch(() => {
    // 取消切换，恢复原值
    currentMode.value = getStorageMode()
  })
}

const handleExport = () => {
  const data = exportAllData()
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `drama-backup-${new Date().toISOString().split('T')[0]}.json`
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success('数据导出成功')
}

const handleImport = () => {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json'
  input.onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return
    
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      
      await ElMessageBox.confirm(
        '导入将覆盖现有数据，确定继续吗？',
        '导入数据',
        {
          confirmButtonText: '确定',
          cancelButtonText: '取消',
          type: 'warning'
        }
      )
      
      importData(data)
      ElMessage.success('数据导入成功')
      window.location.reload()
    } catch (error) {
      ElMessage.error('导入失败：文件格式错误')
    }
  }
  input.click()
}

const handleClear = async () => {
  await ElMessageBox.confirm(
    '确定要清空所有本地数据吗？此操作不可恢复！',
    '清空数据',
    {
      confirmButtonText: '确定清空',
      cancelButtonText: '取消',
      type: 'error'
    }
  )
  
  clearAllData()
  ElMessage.success('数据已清空')
  window.location.reload()
}
</script>

<template>
  <ElCard class="storage-mode-card" shadow="hover">
    <template #header>
      <div class="card-header">
        <span>存储模式设置</span>
      </div>
    </template>
    
    <div class="mode-switch">
      <span class="mode-label">API 服务</span>
      <ElSwitch
        v-model="isLocal"
        @change="handleModeChange"
        active-color="#67c23a"
        inactive-color="#409eff"
      />
      <span class="mode-label">本地存储</span>
    </div>
    
    <div class="mode-description">
      <p v-if="isLocal">
        <strong>本地存储模式</strong>：所有数据存储在浏览器中，无需后端服务。
        适合个人使用和演示。
      </p>
      <p v-else>
        <strong>API 服务模式</strong>：数据通过后端 API 存储在服务器。
        需要配置并运行后端服务。
      </p>
    </div>
    
    <div v-if="isLocal" class="data-actions">
      <ElButton type="primary" size="small" @click="handleExport">
        导出数据
      </ElButton>
      <ElButton type="success" size="small" @click="handleImport">
        导入数据
      </ElButton>
      <ElButton type="danger" size="small" @click="handleClear">
        清空数据
      </ElButton>
    </div>
  </ElCard>
</template>

<style scoped>
.storage-mode-card {
  max-width: 400px;
}

.card-header {
  font-weight: 600;
}

.mode-switch {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.mode-label {
  font-size: 14px;
  color: #666;
}

.mode-description {
  padding: 12px;
  background: #f5f7fa;
  border-radius: 4px;
  margin-bottom: 16px;
}

.mode-description p {
  margin: 0;
  font-size: 13px;
  color: #666;
  line-height: 1.6;
}

.data-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
