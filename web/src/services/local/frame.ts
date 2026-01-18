/**
 * 帧提示词本地存储 API
 * 根据 Go frame_prompt_service.go 业务逻辑实现
 */

import {
  STORAGE_KEYS,
  StorageCollection,
  generateNumericId,
  now,
  getItem
} from '../storage'
import { generateText } from './aiClient'
import type { Drama, Storyboard, Scene, Character } from '../../types/drama'

export type FrameType = 'first' | 'key' | 'last' | 'panel' | 'action'

export interface SingleFramePrompt {
  prompt: string
  description: string
}

export interface MultiFramePrompt {
  layout: string
  frames: SingleFramePrompt[]
}

export interface FramePromptResponse {
  frame_type: FrameType
  single_frame?: SingleFramePrompt
  multi_frame?: MultiFramePrompt
}

export interface GenerateFramePromptRequest {
  frame_type: FrameType
  panel_count?: number
}

export interface FramePromptRecord {
  id: number
  storyboard_id: number
  frame_type: FrameType
  prompt: string
  description?: string
  layout?: string
  created_at: string
  updated_at: string
}

const framePromptCollection = new StorageCollection<FramePromptRecord>(STORAGE_KEYS.FRAME_PROMPTS)

// ========== 辅助函数 ==========

interface StoryboardContext {
  storyboard: Storyboard
  scene?: Scene
  characters: Character[]
}

/**
 * 获取所有 dramas
 */
function getAllDramas(): Drama[] {
  return getItem<Drama[]>(STORAGE_KEYS.DRAMAS) || []
}

/**
 * 根据 storyboardId 查找 storyboard 及其上下文信息
 */
function findStoryboardWithContext(storyboardId: number | string): StoryboardContext | null {
  const dramas = getAllDramas()
  const sbId = String(storyboardId)
  
  for (const drama of dramas) {
    if (!drama.episodes) continue
    
    for (const episode of drama.episodes) {
      const storyboard = episode.storyboards?.find(sb => String(sb.id) === sbId)
      if (storyboard) {
        // 查找关联的场景
        let scene: Scene | undefined
        if (storyboard.scene_id) {
          scene = drama.scenes?.find(s => s.id === storyboard.scene_id)
        }
        
        // 查找关联的角色
        const characters: Character[] = []
        if (storyboard.characters && Array.isArray(storyboard.characters)) {
          for (const charId of storyboard.characters) {
            const char = drama.characters?.find(c => c.id === charId)
            if (char) characters.push(char)
          }
        }
        
        return { storyboard, scene, characters }
      }
    }
  }
  
  return null
}

/**
 * 构建分镜上下文信息（对应 Go buildStoryboardContext）
 */
function buildStoryboardContext(ctx: StoryboardContext): string {
  const parts: string[] = []
  const { storyboard: sb, scene, characters } = ctx
  
  // 镜头描述（最重要）
  if (sb.description) {
    parts.push(`镜头描述: ${sb.description}`)
  }
  
  // 场景信息
  if (scene) {
    parts.push(`场景: ${scene.location}, ${scene.time}`)
  } else if (sb.location && sb.time) {
    parts.push(`场景: ${sb.location}, ${sb.time}`)
  }
  
  // 角色
  if (characters.length > 0) {
    const charNames = characters.map(c => c.name).join(', ')
    parts.push(`角色: ${charNames}`)
  }
  
  // 动作
  if (sb.action) {
    parts.push(`动作: ${sb.action}`)
  }
  
  // 结果
  if ((sb as any).result) {
    parts.push(`结果: ${(sb as any).result}`)
  }
  
  // 对白
  if (sb.dialogue) {
    parts.push(`对白: ${sb.dialogue}`)
  }
  
  // 氛围
  if (sb.atmosphere) {
    parts.push(`氛围: ${sb.atmosphere}`)
  }
  
  // 镜头参数
  if ((sb as any).shot_type) {
    parts.push(`景别: ${(sb as any).shot_type}`)
  }
  if ((sb as any).angle) {
    parts.push(`角度: ${(sb as any).angle}`)
  }
  if ((sb as any).movement) {
    parts.push(`运镜: ${(sb as any).movement}`)
  }
  
  return parts.join('\n')
}

/**
 * 构建降级提示词（AI 失败时使用，对应 Go buildFallbackPrompt）
 */
function buildFallbackPrompt(ctx: StoryboardContext, suffix: string): string {
  const parts: string[] = []
  const { scene, characters, storyboard: sb } = ctx
  
  // 场景
  if (scene) {
    parts.push(`${scene.location}, ${scene.time}`)
  }
  
  // 角色
  for (const char of characters) {
    parts.push(char.name)
  }
  
  // 氛围
  if (sb.atmosphere) {
    parts.push(sb.atmosphere)
  }
  
  parts.push('anime style', suffix)
  return parts.join(', ')
}

/**
 * 保存帧提示词（删除同类型旧记录后插入）
 */
function saveFramePromptInternal(
  storyboardId: number,
  frameType: string,
  prompt: string,
  description: string,
  layout: string
): void {
  // 先删除同类型的旧记录
  const existing = framePromptCollection.filter(
    p => p.storyboard_id === storyboardId && p.frame_type === frameType
  )
  for (const record of existing) {
    framePromptCollection.remove(record.id)
  }
  
  // 插入新记录
  const record: FramePromptRecord = {
    id: generateNumericId('frame_prompt'),
    storyboard_id: storyboardId,
    frame_type: frameType as FrameType,
    prompt,
    description: description || undefined,
    layout: layout || undefined,
    created_at: now(),
    updated_at: now()
  }
  
  framePromptCollection.add(record)
}

// ========== AI 提示词模板 ==========

const FIRST_FRAME_SYSTEM_PROMPT = `你是一个专业的图像生成提示词专家。请根据提供的镜头信息，生成适合用于AI图像生成的提示词。

重要：这是镜头的首帧 - 一个完全静态的画面，展示动作发生之前的初始状态。

要求：
1. 直接输出提示词，不要任何解释说明
2. 可以使用中文或英文，用逗号分隔关键词
3. 只描述静态视觉元素：场景环境、角色姿态、表情、氛围、光线
4. 不要包含任何动作动词（如：猛然、弹起、坐直、抓住等）
5. 描述角色处于动作发生前的状态（如：躺在床上、站立、坐着等静态姿态）
6. 适合动画风格（anime style）

示例格式：
Anime style, 城市公寓卧室, 凌晨, 昏暗房间, 床上, 年轻男子躺着, 表情平静, 闭眼睡眠, 柔和光线, 静谧氛围, 中景, 平视`

const KEY_FRAME_SYSTEM_PROMPT = `你是一个专业的图像生成提示词专家。请根据提供的镜头信息，生成适合用于AI图像生成的提示词。

重要：这是镜头的关键帧 - 捕捉动作最激烈、最精彩的瞬间。

要求：
1. 直接输出提示词，不要任何解释说明
2. 可以使用中文或英文，用逗号分隔关键词
3. 重点描述动作的高潮瞬间：身体姿态、运动轨迹、力量感
4. 包含动态元素：动作模糊、速度线、冲击感
5. 强调表情和情绪的极致状态
6. 适合动画风格（anime style）

示例格式：
Anime style, 城市街道, 白天, 男子全力冲刺, 身体前倾, 动作模糊, 速度线, 汗水飞溅, 表情坚毅, 紧张氛围, 动态镜头, 中景`

const LAST_FRAME_SYSTEM_PROMPT = `你是一个专业的图像生成提示词专家。请根据提供的镜头信息，生成适合用于AI图像生成的提示词。

重要：这是镜头的尾帧 - 一个静态画面，展示动作结束后的最终状态和结果。

要求：
1. 直接输出提示词，不要任何解释说明
2. 可以使用中文或英文，用逗号分隔关键词
3. 只描述静态的最终状态：角色姿态、表情、环境变化
4. 不要包含动作过程，只展示动作的结果和余韵
5. 强调情绪的余波和氛围的沉淀
6. 适合动画风格（anime style）

示例格式：
Anime style, 房间内, 黄昏, 男子坐在椅子上, 身体放松, 表情疲惫, 长出一口气, 汗水滴落, 平静氛围, 静态镜头, 中景`

// ========== 帧生成函数 ==========

/**
 * 生成首帧提示词
 */
async function generateFirstFramePrompt(ctx: StoryboardContext): Promise<SingleFramePrompt> {
  const contextInfo = buildStoryboardContext(ctx)
  const userPrompt = `镜头信息：\n${contextInfo}\n\n请直接生成首帧的图像提示词，不要任何解释：`
  
  let prompt: string
  try {
    prompt = await generateText(userPrompt, { systemPrompt: FIRST_FRAME_SYSTEM_PROMPT })
    prompt = prompt.trim()
    if (!prompt) {
      console.warn('[Frame] AI returned empty prompt, using fallback')
      prompt = buildFallbackPrompt(ctx, 'first frame, static shot')
    }
  } catch (error) {
    console.warn('[Frame] AI generation failed, using fallback:', error)
    prompt = buildFallbackPrompt(ctx, 'first frame, static shot')
  }
  
  return {
    prompt,
    description: '镜头开始的静态画面，展示初始状态'
  }
}

/**
 * 生成关键帧提示词
 */
async function generateKeyFramePrompt(ctx: StoryboardContext): Promise<SingleFramePrompt> {
  const contextInfo = buildStoryboardContext(ctx)
  const userPrompt = `镜头信息：\n${contextInfo}\n\n请直接生成关键帧的图像提示词，不要任何解释：`
  
  let prompt: string
  try {
    prompt = await generateText(userPrompt, { systemPrompt: KEY_FRAME_SYSTEM_PROMPT })
    prompt = prompt.trim()
    if (!prompt) {
      console.warn('[Frame] AI returned empty prompt, using fallback')
      prompt = buildFallbackPrompt(ctx, 'key frame, dynamic action')
    }
  } catch (error) {
    console.warn('[Frame] AI generation failed, using fallback:', error)
    prompt = buildFallbackPrompt(ctx, 'key frame, dynamic action')
  }
  
  return {
    prompt,
    description: '动作高潮瞬间，展示关键动作'
  }
}

/**
 * 生成尾帧提示词
 */
async function generateLastFramePrompt(ctx: StoryboardContext): Promise<SingleFramePrompt> {
  const contextInfo = buildStoryboardContext(ctx)
  const userPrompt = `镜头信息：\n${contextInfo}\n\n请直接生成尾帧的图像提示词，不要任何解释：`
  
  let prompt: string
  try {
    prompt = await generateText(userPrompt, { systemPrompt: LAST_FRAME_SYSTEM_PROMPT })
    prompt = prompt.trim()
    if (!prompt) {
      console.warn('[Frame] AI returned empty prompt, using fallback')
      prompt = buildFallbackPrompt(ctx, 'last frame, final state')
    }
  } catch (error) {
    console.warn('[Frame] AI generation failed, using fallback:', error)
    prompt = buildFallbackPrompt(ctx, 'last frame, final state')
  }
  
  return {
    prompt,
    description: '镜头结束画面，展示最终状态和结果'
  }
}

/**
 * 生成分镜板（多格组合）
 */
async function generatePanelFramesInternal(ctx: StoryboardContext, count: number): Promise<MultiFramePrompt> {
  const layout = `horizontal_${count}`
  const frames: SingleFramePrompt[] = []
  
  if (count === 3) {
    // 首帧 -> 关键帧 -> 尾帧
    const first = await generateFirstFramePrompt(ctx)
    first.description = '第1格：初始状态'
    frames.push(first)
    
    const key = await generateKeyFramePrompt(ctx)
    key.description = '第2格：动作高潮'
    frames.push(key)
    
    const last = await generateLastFramePrompt(ctx)
    last.description = '第3格：最终状态'
    frames.push(last)
  } else if (count === 4) {
    // 首帧 -> 中间帧1 -> 中间帧2 -> 尾帧
    frames.push(await generateFirstFramePrompt(ctx))
    frames.push(await generateKeyFramePrompt(ctx))
    frames.push(await generateKeyFramePrompt(ctx))
    frames.push(await generateLastFramePrompt(ctx))
  } else {
    // 默认按比例分配
    frames.push(await generateFirstFramePrompt(ctx))
    for (let i = 1; i < count - 1; i++) {
      frames.push(await generateKeyFramePrompt(ctx))
    }
    frames.push(await generateLastFramePrompt(ctx))
  }
  
  return { layout, frames }
}

/**
 * 生成动作序列（5格）
 */
async function generateActionSequenceInternal(ctx: StoryboardContext): Promise<MultiFramePrompt> {
  const frames: SingleFramePrompt[] = []
  
  // 首帧 -> 3个关键帧 -> 尾帧
  frames.push(await generateFirstFramePrompt(ctx))
  frames.push(await generateKeyFramePrompt(ctx))
  frames.push(await generateKeyFramePrompt(ctx))
  frames.push(await generateKeyFramePrompt(ctx))
  frames.push(await generateLastFramePrompt(ctx))
  
  return {
    layout: 'horizontal_5',
    frames
  }
}

// ========== 导出 API ==========

export const localFrameAPI = {
  /**
   * 生成指定类型的帧提示词并保存
   */
  async generateFramePrompt(
    storyboardId: number,
    data: GenerateFramePromptRequest
  ): Promise<FramePromptResponse> {
    // 查找分镜上下文
    const ctx = findStoryboardWithContext(storyboardId)
    if (!ctx) {
      throw new Error(`Storyboard not found: ${storyboardId}`)
    }
    
    const response: FramePromptResponse = {
      frame_type: data.frame_type
    }
    
    switch (data.frame_type) {
      case 'first': {
        response.single_frame = await generateFirstFramePrompt(ctx)
        saveFramePromptInternal(
          storyboardId,
          'first',
          response.single_frame.prompt,
          response.single_frame.description,
          ''
        )
        break
      }
      case 'key': {
        response.single_frame = await generateKeyFramePrompt(ctx)
        saveFramePromptInternal(
          storyboardId,
          'key',
          response.single_frame.prompt,
          response.single_frame.description,
          ''
        )
        break
      }
      case 'last': {
        response.single_frame = await generateLastFramePrompt(ctx)
        saveFramePromptInternal(
          storyboardId,
          'last',
          response.single_frame.prompt,
          response.single_frame.description,
          ''
        )
        break
      }
      case 'panel': {
        const count = data.panel_count || 3
        response.multi_frame = await generatePanelFramesInternal(ctx, count)
        // 保存多帧提示词（合并为一条记录）
        const combinedPrompt = response.multi_frame.frames.map(f => f.prompt).join('\n---\n')
        saveFramePromptInternal(
          storyboardId,
          'panel',
          combinedPrompt,
          '分镜板组合提示词',
          response.multi_frame.layout
        )
        break
      }
      case 'action': {
        response.multi_frame = await generateActionSequenceInternal(ctx)
        const combinedPrompt = response.multi_frame.frames.map(f => f.prompt).join('\n---\n')
        saveFramePromptInternal(
          storyboardId,
          'action',
          combinedPrompt,
          '动作序列组合提示词',
          response.multi_frame.layout
        )
        break
      }
      default:
        throw new Error(`Unsupported frame type: ${data.frame_type}`)
    }
    
    return response
  },

  async generateFirstFrame(storyboardId: number): Promise<FramePromptResponse> {
    return this.generateFramePrompt(storyboardId, { frame_type: 'first' })
  },

  async generateKeyFrame(storyboardId: number): Promise<FramePromptResponse> {
    return this.generateFramePrompt(storyboardId, { frame_type: 'key' })
  },

  async generateLastFrame(storyboardId: number): Promise<FramePromptResponse> {
    return this.generateFramePrompt(storyboardId, { frame_type: 'last' })
  },

  async generatePanelFrames(storyboardId: number, panelCount: number = 3): Promise<FramePromptResponse> {
    return this.generateFramePrompt(storyboardId, { frame_type: 'panel', panel_count: panelCount })
  },

  async generateActionSequence(storyboardId: number): Promise<FramePromptResponse> {
    return this.generateFramePrompt(storyboardId, { frame_type: 'action' })
  },

  async getStoryboardFramePrompts(storyboardId: number): Promise<{ frame_prompts: FramePromptRecord[] }> {
    const prompts = framePromptCollection.filter(p => p.storyboard_id === storyboardId)
    return { frame_prompts: prompts }
  },

  async saveFramePrompt(storyboardId: number, data: Partial<FramePromptRecord>): Promise<FramePromptRecord> {
    // 先删除同类型的旧记录
    if (data.frame_type) {
      const existing = framePromptCollection.filter(
        p => p.storyboard_id === storyboardId && p.frame_type === data.frame_type
      )
      for (const record of existing) {
        framePromptCollection.remove(record.id)
      }
    }
    
    const record: FramePromptRecord = {
      id: generateNumericId('frame_prompt'),
      storyboard_id: storyboardId,
      frame_type: data.frame_type || 'key',
      prompt: data.prompt || '',
      description: data.description,
      layout: data.layout,
      created_at: now(),
      updated_at: now()
    }
    
    return framePromptCollection.add(record)
  }
}
