/**
 * 资产本地存储 API
 */

import type {
  Asset,
  CreateAssetRequest,
  ListAssetsParams,
  UpdateAssetRequest
} from '../../types/asset'
import {
  STORAGE_KEYS,
  StorageCollection,
  generateNumericId,
  now,
  paginate
} from '../storage'
import type { VideoGeneration } from '../../types/video'
import type { ImageGeneration } from '../../types/image'
import type { Drama, Episode, Storyboard } from '../../types/drama'

const videoCollection = new StorageCollection<VideoGeneration>(STORAGE_KEYS.VIDEOS)
const imageCollection = new StorageCollection<ImageGeneration>(STORAGE_KEYS.IMAGES)
const dramaCollection = new StorageCollection<Drama>(STORAGE_KEYS.DRAMAS)

const assetCollection = new StorageCollection<Asset>(STORAGE_KEYS.ASSETS)

/**
 * 查找分镜并返回分镜、剧集和剧本信息
 * 对应 Go 的 Preload("Storyboard.Episode")
 */
function findStoryboardWithEpisode(storyboardId: number): { 
  storyboard: Storyboard
  episode: Episode
  drama: Drama 
} | null {
  const dramas = dramaCollection.getAll()
  const sbId = String(storyboardId)
  
  for (const drama of dramas) {
    if (!drama.episodes) continue
    
    for (const episode of drama.episodes) {
      const storyboard = episode.storyboards?.find(sb => String(sb.id) === sbId)
      if (storyboard) {
        return { storyboard, episode, drama }
      }
    }
  }
  return null
}

export const localAssetAPI = {
  async createAsset(data: CreateAssetRequest): Promise<Asset> {
    const asset: Asset = {
      id: generateNumericId('asset'),
      drama_id: data.drama_id,
      name: data.name,
      description: data.description,
      type: data.type,
      category: data.category,
      url: data.url,
      thumbnail_url: data.thumbnail_url,
      local_path: data.local_path,
      file_size: data.file_size,
      mime_type: data.mime_type,
      width: data.width,
      height: data.height,
      duration: data.duration,
      format: data.format,
      image_gen_id: data.image_gen_id,
      video_gen_id: data.video_gen_id,
      is_favorite: false,
      view_count: 0,
      created_at: now(),
      updated_at: now()
    }
    
    return assetCollection.add(asset)
  },

  async updateAsset(id: number, data: UpdateAssetRequest): Promise<Asset> {
    const updated = assetCollection.update(id, {
      ...data,
      updated_at: now()
    } as any)
    
    if (!updated) {
      throw new Error('资产不存在')
    }
    return updated
  },

  async getAsset(id: number): Promise<Asset> {
    const asset = assetCollection.getById(id)
    if (!asset) {
      throw new Error('资产不存在')
    }
    return asset
  },

  async listAssets(params: ListAssetsParams) {
    let items = assetCollection.getAll()
    
    // Filter by drama_id (handle string/number comparison)
    if (params.drama_id) {
      const dramaIdStr = String(params.drama_id)
      items = items.filter(i => String(i.drama_id) === dramaIdStr)
    }
    
    // Filter by episode_id (handle string comparison)
    if (params.episode_id) {
      const episodeIdStr = String(params.episode_id)
      items = items.filter(i => String(i.episode_id) === episodeIdStr)
    }
    
    // Filter by storyboard_id
    if (params.storyboard_id) {
      items = items.filter(i => i.storyboard_id === params.storyboard_id)
    }
    
    // Filter by type
    if (params.type) {
      items = items.filter(i => i.type === params.type)
    }
    
    items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    
    return paginate(items, params.page || 1, params.page_size || 20)
  },

  async deleteAsset(id: number): Promise<void> {
    assetCollection.delete(id)
  },

  async importFromImage(imageGenId: number): Promise<Asset> {
    // 获取图片生成记录
    const imageGen = imageCollection.getById(imageGenId)
    if (!imageGen) {
      throw new Error('图片生成记录不存在')
    }
    
    const asset: Asset = {
      id: generateNumericId('asset'),
      drama_id: imageGen.drama_id ? Number(imageGen.drama_id) : undefined,
      storyboard_id: imageGen.storyboard_id,
      name: `图片资产 ${imageGenId}`,
      type: 'image',
      url: imageGen.image_url || '',
      thumbnail_url: imageGen.image_url,
      width: imageGen.width,
      height: imageGen.height,
      image_gen_id: imageGenId,
      is_favorite: false,
      view_count: 0,
      created_at: now(),
      updated_at: now()
    }
    
    return assetCollection.add(asset)
  },

  /**
   * 从视频生成记录导入素材
   * 对应 Go AssetService.ImportFromVideoGen
   */
  async importFromVideo(videoGenId: number): Promise<Asset> {
    // 获取视频生成记录（对应 Go 的 Preload("Storyboard.Episode")）
    const videoGen = videoCollection.getById(videoGenId)
    if (!videoGen) {
      throw new Error('video generation not found')
    }
    
    // 检查视频是否已完成
    if (videoGen.status !== 'completed' || !videoGen.video_url) {
      throw new Error('video is not ready')
    }
    
    // 获取 episode_id, storyboard_num 和 drama_id（对应 Go 的 Preload）
    let dramaId: string | undefined = videoGen.drama_id ? String(videoGen.drama_id) : undefined
    let episodeId: string | undefined
    let storyboardNum: number | undefined
    
    if (videoGen.storyboard_id) {
      const found = findStoryboardWithEpisode(videoGen.storyboard_id)
      if (found) {
        // 优先从 storyboard 关联的 drama 获取 drama_id
        dramaId = dramaId || found.drama.id
        episodeId = found.episode.id  // Keep as string (e.g., "ep_xxx")
        storyboardNum = found.storyboard.storyboard_number
      }
    }
    
    // 创建素材（对应 Go 的 Asset 结构）
    // Note: IDs are strings in local storage but numbers in type definition
    const asset: Asset = {
      id: generateNumericId('asset'),
      name: `Video_${videoGenId}`,
      type: 'video',
      url: videoGen.video_url,
      drama_id: dramaId as any,  // Local IDs are strings like "drama_xxx"
      episode_id: episodeId as any,  // Local IDs are strings like "ep_xxx"
      storyboard_id: videoGen.storyboard_id,
      storyboard_num: storyboardNum,
      video_gen_id: videoGenId,
      duration: videoGen.duration,
      width: videoGen.width,
      height: videoGen.height,
      thumbnail_url: videoGen.first_frame_url || videoGen.image_url,
      is_favorite: false,
      view_count: 0,
      created_at: now(),
      updated_at: now()
    }
    
    return assetCollection.add(asset)
  }
}
