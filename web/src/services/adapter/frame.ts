/**
 * Frame Prompt API 适配器
 */

import * as frameAPI from '../../api/frame'
import { localFrameAPI } from '../local/frame'
import { isLocalMode } from '../config'

// 帧提示词服务
export const frameService = {
  generateFramePrompt: (storyboardId: number, data: frameAPI.GenerateFramePromptRequest) => {
    return isLocalMode()
      ? localFrameAPI.generateFramePrompt(storyboardId, data)
      : frameAPI.generateFramePrompt(storyboardId, data)
  },

  generateFirstFrame: (storyboardId: number) => {
    return isLocalMode()
      ? localFrameAPI.generateFirstFrame(storyboardId)
      : frameAPI.generateFirstFrame(storyboardId)
  },

  generateKeyFrame: (storyboardId: number) => {
    return isLocalMode()
      ? localFrameAPI.generateKeyFrame(storyboardId)
      : frameAPI.generateKeyFrame(storyboardId)
  },

  generateLastFrame: (storyboardId: number) => {
    return isLocalMode()
      ? localFrameAPI.generateLastFrame(storyboardId)
      : frameAPI.generateLastFrame(storyboardId)
  },

  generatePanelFrames: (storyboardId: number, panelCount?: number) => {
    return isLocalMode()
      ? localFrameAPI.generatePanelFrames(storyboardId, panelCount)
      : frameAPI.generatePanelFrames(storyboardId, panelCount)
  },

  generateActionSequence: (storyboardId: number) => {
    return isLocalMode()
      ? localFrameAPI.generateActionSequence(storyboardId)
      : frameAPI.generateActionSequence(storyboardId)
  },

  getStoryboardFramePrompts: (storyboardId: number) => {
    return isLocalMode()
      ? localFrameAPI.getStoryboardFramePrompts(storyboardId)
      : frameAPI.getStoryboardFramePrompts(storyboardId)
  }
}

// 本地模式专用方法
export const localFrameService = localFrameAPI
