<template>
  <div class="app-layout">
    <!-- Global Header -->
    <header class="app-header">
      <div class="header-content">
        <!-- Left section: Logo + Left slot -->
        <div class="header-left">
          <router-link to="/" class="logo">
            <span class="logo-text">🎬 AI Drama</span>
          </router-link>
          <!-- Left slot for business content | 左侧插槽用于业务内容 -->
          <slot name="left" />
        </div>

        <!-- Center section: Center slot -->
        <div class="header-center">
          <slot name="center" />
        </div>

        <!-- Right section: Actions + Right slot -->
        <div class="header-right">
          <LanguageSwitcher />
          <ThemeToggle />
          <el-button @click="showAIConfig = true" class="header-btn">
            <el-icon><Setting /></el-icon>
            <span class="btn-text">{{ $t('drama.aiConfig') }}</span>
          </el-button>
          <!-- Right slot for business content (before actions) | 右侧插槽（在操作按钮前） -->
          <slot name="right" />
        </div>
      </div>
    </header>

    <!-- Main Content -->
    <main class="app-main">
      <slot />
    </main>

    <!-- AI Config Dialog -->
    <AIConfigDialog v-model="showAIConfig" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Setting } from '@element-plus/icons-vue'
import ThemeToggle from './ThemeToggle.vue'
import AIConfigDialog from './AIConfigDialog.vue'
import LanguageSwitcher from '@/components/LanguageSwitcher.vue'

const showAIConfig = ref(false)
</script>

<style scoped>
.app-layout {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.app-header {
  position: sticky;
  top: 0;
  z-index: 100;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-primary);
  backdrop-filter: blur(8px);
}

.header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-4);
  height: 56px;
  max-width: 100%;
  margin: 0 auto;
}
.header-btn {
  border-radius: var(--radius-lg);
  font-weight: 500;
}

.header-btn.primary {
  background: linear-gradient(135deg, var(--accent) 0%, #0284c7 100%);
  border: none;
  box-shadow: 0 4px 14px rgba(14, 165, 233, 0.35);
}

.header-btn.primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 20px rgba(14, 165, 233, 0.45);
}
.header-left {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex-shrink: 0;
}

.header-center {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-width: 0;
}

.logo {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  text-decoration: none;
  color: var(--text-primary);
  font-weight: 700;
  font-size: 1.125rem;
  transition: opacity var(--transition-fast);
}

.logo:hover {
  opacity: 0.8;
}

.logo-text {
  background: linear-gradient(135deg, var(--accent) 0%, #06b6d4 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.header-right {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
}

.header-btn .btn-text {
  margin-left: 4px;
}

.app-main {
  flex: 1;
}

/* Dark mode adjustments */
.dark .app-header {
  background: rgba(26, 33, 41, 0.95);
}

/* Responsive | 响应式 */
@media (max-width: 768px) {
  .header-content {
    padding: 0 var(--space-3);
  }
  
  .btn-text {
    display: none;
  }
  
  .header-btn {
    padding: 8px;
  }
}
</style>
