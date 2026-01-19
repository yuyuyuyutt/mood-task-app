import { useState, useEffect } from 'react';
import { BaseDirectory, exists, readTextFile, writeTextFile, readFile, writeFile, remove, mkdir } from '@tauri-apps/plugin-fs';

interface UserProfile {
  name: string;
  avatarFilename: string | null;
}

interface UseUserProfileReturn {
  userProfile: UserProfile & { avatarUrl?: string | null };
  uploading: boolean;
  updateUserName: (name: string) => Promise<void>;
  updateUserAvatar: (file: File) => Promise<string>;
  removeAvatar: () => Promise<void>;
}

const DEFAULT_USER_PROFILE: UserProfile = {
  name: '高山用户',
  avatarFilename: null
};

export function useUserProfileTauri(): UseUserProfileReturn {
  const [userProfile, setUserProfile] = useState<UserProfile>(DEFAULT_USER_PROFILE);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // 初始化函数 - 确保必要的目录存在
  const initializeAppData = async () => {
    try {
      // 使用 mkdir 创建目录（如果需要）
      await mkdir('avatars', { 
        baseDir: BaseDirectory.AppData,
        recursive: true 
      });
      console.log('Avatar directory initialized');
    } catch (error) {
      console.warn('Avatar directory may already exist:', error);
    }
  };

  // 检查文件是否存在并修复路径
  const checkAndFixFilePath = async (path: string): Promise<string> => {
    try {
      const fileExists = await exists(path, { baseDir: BaseDirectory.AppData });
      if (!fileExists) {
        console.warn(`File does not exist: ${path}`);
        
        // 尝试修复路径
        const fixedPath = path.replace(/\\/g, '/').replace(/\/\//g, '/');
        const fixedExists = await exists(fixedPath, { baseDir: BaseDirectory.AppData });
        
        if (fixedExists) {
          console.log(`Found file at fixed path: ${fixedPath}`);
          return fixedPath;
        }
      }
      return path;
    } catch (error) {
      console.error('Error checking file path:', error);
      return path;
    }
  };

  // 加载用户资料
  const loadUserProfile = async () => {
    try {
      // 初始化目录结构
      await initializeAppData();
      
      const profilePath = 'user_profile.json';
      const profileExists = await exists(profilePath, { baseDir: BaseDirectory.AppData });
      
      if (profileExists) {
        // 使用 readTextFile 读取文本文件
        const content = await readTextFile(profilePath, { baseDir: BaseDirectory.AppData });
        const parsed = JSON.parse(content);
        setUserProfile(parsed);
        
        // 如果有头像，加载头像
        if (parsed.avatarFilename) {
          await loadAvatar(parsed.avatarFilename);
        }
      } else {
        // 如果文件不存在，使用 writeTextFile 创建默认的配置文件
        await saveUserProfile(DEFAULT_USER_PROFILE);
      }
    } catch (error: any) {
      console.error('Failed to load user profile:', error);
      // 尝试创建默认文件
      try {
        await saveUserProfile(DEFAULT_USER_PROFILE);
      } catch (e) {
        console.error('Failed to create default profile:', e);
      }
    }
  };

  // 将 Uint8Array 转换为 Base64 字符串
  const uint8ArrayToBase64 = (bytes: Uint8Array): string => {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  };

  // 加载头像图片 - 使用 Base64
  const loadAvatar = async (filename: string) => {
    try {
      const avatarPath = `avatars/${filename}`;
      
      // 检查并修复文件路径
      const checkedPath = await checkAndFixFilePath(avatarPath);
      
      const avatarExists = await exists(checkedPath, { baseDir: BaseDirectory.AppData });
      
      if (avatarExists) {
        // 使用 readFile 读取二进制文件
        const bytes = await readFile(checkedPath, { baseDir: BaseDirectory.AppData });
        
        // 根据文件扩展名确定 MIME 类型
        const extension = filename.split('.').pop()?.toLowerCase();
        let mimeType = 'image/jpeg'; // 默认
        
        if (extension === 'png') mimeType = 'image/png';
        else if (extension === 'gif') mimeType = 'image/gif';
        else if (extension === 'webp') mimeType = 'image/webp';
        else if (extension === 'svg') mimeType = 'image/svg+xml';
        
        // 将 Uint8Array 转换为 Base64
        const base64 = uint8ArrayToBase64(bytes);
        
        // 创建 Data URL
        const url = `data:${mimeType};base64,${base64}`;
        setAvatarUrl(url);
        console.log(`Avatar loaded as Base64: ${filename}`);
      } else {
        console.warn(`Avatar file not found: ${checkedPath}`);
        // 如果头像文件不存在，清除头像引用
        await saveUserProfile({
          ...userProfile,
          avatarFilename: null
        });
      }
    } catch (error) {
      console.error('Failed to load avatar:', error);
      setAvatarUrl(null);
    }
  };

  // 保存用户资料
  const saveUserProfile = async (profile: UserProfile) => {
    try {
      // 使用 writeTextFile 创建或更新文本文件
      await writeTextFile(
        'user_profile.json', 
        JSON.stringify(profile, null, 2), 
        { baseDir: BaseDirectory.AppData }
      );
      setUserProfile(profile);
      
      // 如果有头像，加载它
      if (profile.avatarFilename) {
        await loadAvatar(profile.avatarFilename);
      } else {
        setAvatarUrl(null);
      }
    } catch (error) {
      console.error('Failed to save user profile:', error);
    }
  };

  // 压缩图片 - 直接返回 Blob 而不是 File
  const compressImage = (file: File): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();
      
      reader.onload = (e) => {
        img.src = e.target?.result as string;
        
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          
          const MAX_SIZE = 300;
          let width = img.width;
          let height = img.height;
          
          if (width > height) {
            if (width > MAX_SIZE) {
              height *= MAX_SIZE / width;
              width = MAX_SIZE;
            }
          } else {
            if (height > MAX_SIZE) {
              width *= MAX_SIZE / height;
              height = MAX_SIZE;
            }
          }
          
          canvas.width = width;
          canvas.height = height;
          
          ctx?.drawImage(img, 0, 0, width, height);
          
          canvas.toBlob((blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('图片压缩失败'));
            }
          }, 'image/jpeg', 0.8);
        };
        
        img.onerror = () => reject(new Error('图片加载失败'));
      };
      
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsDataURL(file);
    });
  };

  // 将 Blob 转换为 Uint8Array
  const blobToUint8Array = async (blob: Blob): Promise<Uint8Array> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) {
          resolve(new Uint8Array(reader.result));
        } else {
          reject(new Error('无法转换 Blob 为 Uint8Array'));
        }
      };
      
      reader.onerror = () => reject(new Error('Blob 读取失败'));
      reader.readAsArrayBuffer(blob);
    });
  };

  // 更新用户名
  const updateUserName = async (name: string) => {
    if (name.trim()) {
      await saveUserProfile({
        ...userProfile,
        name: name.trim()
      });
    }
  };

  // 更新用户头像
  const updateUserAvatar = async (file: File): Promise<string> => {
    if (!file.type.startsWith('image/')) {
      throw new Error('请选择图片文件');
    }
    
    if (file.size > 10 * 1024 * 1024) {
      throw new Error('图片大小不能超过10MB');
    }
    
    setUploading(true);
    try {
      // 压缩图片
      const compressedBlob = await compressImage(file);
      
      // 生成唯一文件名
      const timestamp = Date.now();
      const filename = `avatar_${timestamp}.jpg`;
      
      // 确保目录存在
      await initializeAppData();
      
      // 将 Blob 转换为 Uint8Array
      const uint8Array = await blobToUint8Array(compressedBlob);
      
      // 使用 writeFile 创建头像文件
      const avatarPath = `avatars/${filename}`;
      await writeFile(avatarPath, uint8Array, { baseDir: BaseDirectory.AppData });
      
      // 删除旧的头像文件（如果有）
      if (userProfile.avatarFilename && userProfile.avatarFilename !== filename) {
        try {
          const oldAvatarPath = `avatars/${userProfile.avatarFilename}`;
          // 使用 remove 删除文件
          await remove(oldAvatarPath, { baseDir: BaseDirectory.AppData });
        } catch (error) {
          console.warn('Failed to delete old avatar:', error);
        }
      }
      
      // 更新用户资料
      await saveUserProfile({
        ...userProfile,
        avatarFilename: filename
      });
      
      console.log(`Avatar saved: ${filename}`);
      return filename;
    } catch (error) {
      console.error('Failed to update avatar:', error);
      throw error;
    } finally {
      setUploading(false);
    }
  };

  // 删除头像
  const removeAvatar = async () => {
    if (userProfile.avatarFilename) {
      try {
        const avatarPath = `avatars/${userProfile.avatarFilename}`;
        // 使用 remove 删除文件
        await remove(avatarPath, { baseDir: BaseDirectory.AppData });
      } catch (error) {
        console.warn('Failed to delete avatar file:', error);
      }
    }
    
    // 更新用户资料，移除头像文件名
    await saveUserProfile({
      ...userProfile,
      avatarFilename: null
    });
  };

  // 初始加载
  useEffect(() => {
    loadUserProfile();
  }, []);

  return {
    userProfile: {
      ...userProfile,
      avatarUrl
    },
    uploading,
    updateUserName,
    updateUserAvatar,
    removeAvatar
  };
}