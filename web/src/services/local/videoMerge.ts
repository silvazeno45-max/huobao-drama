/**
 * 视频合成本地存储 API
 */

import {
  STORAGE_KEYS,
  StorageCollection,
  generateNumericId,
  now
} from '../storage'

export interface SceneClip {
  scene_id: string
  video_url: string
  start_time: number
  end_time: number
  duration: number
  order: number
}

export interface MergeVideoRequest {
  episode_id: string
  drama_id: string
  title: string
  scenes: SceneClip[]
  provider?: string
  model?: string
}

export interface VideoMerge {
  id: number
  episode_id: string
  drama_id: string
  title: string
  provider: string
  model?: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  scenes: SceneClip[]
  merged_url?: string
  duration?: number
  task_id?: string
  error_msg?: string
  created_at: string
  completed_at?: string
}

const mergeCollection = new StorageCollection<VideoMerge>(STORAGE_KEYS.VIDEO_MERGES)

export const localVideoMergeAPI = {
  async mergeVideos(data: MergeVideoRequest): Promise<VideoMerge> {
    const totalDuration = data.scenes.reduce((sum, s) => sum + s.duration, 0)
    
    const merge: VideoMerge = {
      id: generateNumericId('merge'),
      episode_id: data.episode_id,
      drama_id: data.drama_id,
      title: data.title,
      provider: data.provider || 'local',
      model: data.model,
      status: 'pending',
      scenes: data.scenes,
      duration: totalDuration,
      created_at: now()
    }
    
    return mergeCollection.add(merge)
  },

  async getMerge(mergeId: number): Promise<VideoMerge> {
    const merge = mergeCollection.getById(mergeId)
    if (!merge) {
      throw new Error('合成记录不存在')
    }
    return merge
  },

  async listMerges(params: {
    episode_id?: string
    status?: string
    page?: number
    page_size?: number
  }): Promise<{ merges: VideoMerge[]; total: number }> {
    let items = mergeCollection.getAll()
    
    if (params.episode_id) {
      items = items.filter(i => i.episode_id === params.episode_id)
    }
    if (params.status) {
      items = items.filter(i => i.status === params.status)
    }
    
    items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    
    const page = params.page || 1
    const pageSize = params.page_size || 20
    const start = (page - 1) * pageSize
    const end = start + pageSize
    
    return {
      merges: items.slice(start, end),
      total: items.length
    }
  },

  async deleteMerge(mergeId: number): Promise<void> {
    mergeCollection.delete(mergeId)
  },

  async updateMergeStatus(mergeId: number, status: VideoMerge['status'], mergedUrl?: string): Promise<VideoMerge> {
    const updated = mergeCollection.update(mergeId, {
      status,
      merged_url: mergedUrl,
      completed_at: status === 'completed' ? now() : undefined
    })
    if (!updated) {
      throw new Error('合成记录不存在')
    }
    return updated
  }
}
