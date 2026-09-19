// src/hooks/useUserProfileTauri.ts
// 用户资料读写。桌面端落在 AppData（user_profile.json + avatars/*.jpg），
// 浏览器开发模式退回 localStorage，两条路径对外语义一致。
//
// 为什么不直接静态 import @tauri-apps/plugin-fs：
// 它的实现是 window.__TAURI_INTERNALS__.invoke(...)，浏览器里该全局不存在，
// 调用即抛 "Cannot read properties of undefined (reading 'invoke')"。
// 因此所有 fs 调用都收敛到 profileStore，并在 isTauriRuntime() 分支内动态 import。
import { useCallback, useEffect, useState } from 'react';
import { isTauriRuntime } from '../utils/runtime';

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
  avatarFilename: null,
};

const PROFILE_FILE = 'user_profile.json';
const AVATAR_DIR = 'avatars';

/** 浏览器兜底键名，沿用项目 `mood-task:<domain>:v1` 约定 */
const LS_PROFILE_KEY = 'mood-task:user-profile:v1';
const LS_AVATAR_KEY = 'mood-task:user-avatar:v1';

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

function mimeFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? 'image/jpeg';
}

/** 分批调用 fromCharCode，避免大数组触发 "Maximum call stack size exceeded" */
function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${mime};base64,${window.btoa(binary)}`;
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  const binary = window.atob(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** 磁盘 / localStorage 里的内容都不可信，读出来一律过一遍归一化 */
function normalizeProfile(raw: unknown): UserProfile {
  const obj = (raw ?? {}) as Partial<UserProfile>;
  const name = typeof obj.name === 'string' ? obj.name.trim() : '';
  return {
    name: name || DEFAULT_USER_PROFILE.name,
    avatarFilename: typeof obj.avatarFilename === 'string' ? obj.avatarFilename : null,
  };
}

/**
 * 资料存储适配层。调用方无需感知运行环境。
 * - Tauri：AppData/user_profile.json + AppData/avatars/*
 * - 浏览器：localStorage（资料 JSON + 头像 data URL）
 */
const profileStore = {
  async readProfile(): Promise<UserProfile | null> {
    if (isTauriRuntime()) {
      const { BaseDirectory, exists, readTextFile } = await import('@tauri-apps/plugin-fs');
      const opts = { baseDir: BaseDirectory.AppData };
      if (!(await exists(PROFILE_FILE, opts))) return null;
      return normalizeProfile(JSON.parse(await readTextFile(PROFILE_FILE, opts)));
    }
    const raw = localStorage.getItem(LS_PROFILE_KEY);
    return raw ? normalizeProfile(JSON.parse(raw)) : null;
  },

  async writeProfile(profile: UserProfile): Promise<void> {
    const json = JSON.stringify(profile, null, 2);
    if (isTauriRuntime()) {
      const { BaseDirectory, mkdir, writeTextFile } = await import('@tauri-apps/plugin-fs');
      const opts = { baseDir: BaseDirectory.AppData };
      // recursive 在目录已存在时也可能抛，这里只为确保目录就绪，失败交给后续写入报错
      await mkdir(AVATAR_DIR, { ...opts, recursive: true }).catch(() => undefined);
      await writeTextFile(PROFILE_FILE, json, opts);
      return;
    }
    localStorage.setItem(LS_PROFILE_KEY, json);
  },

  /** 读取头像为 data URL；没有或读取失败返回 null */
  async readAvatar(profile: UserProfile): Promise<string | null> {
    if (!profile.avatarFilename) return null;
    if (isTauriRuntime()) {
      const { BaseDirectory, exists, readFile } = await import('@tauri-apps/plugin-fs');
      const opts = { baseDir: BaseDirectory.AppData };
      const path = `${AVATAR_DIR}/${profile.avatarFilename}`;
      if (!(await exists(path, opts))) return null;
      return bytesToDataUrl(await readFile(path, opts), mimeFromFilename(profile.avatarFilename));
    }
    return localStorage.getItem(LS_AVATAR_KEY);
  },

  /** 写入头像，返回落盘文件名 */
  async writeAvatar(dataUrl: string): Promise<string> {
    const filename = `avatar_${Date.now()}.jpg`;
    if (isTauriRuntime()) {
      const { BaseDirectory, mkdir, writeFile } = await import('@tauri-apps/plugin-fs');
      const opts = { baseDir: BaseDirectory.AppData };
      await mkdir(AVATAR_DIR, { ...opts, recursive: true }).catch(() => undefined);
      await writeFile(`${AVATAR_DIR}/${filename}`, dataUrlToBytes(dataUrl), opts);
      return filename;
    }
    localStorage.setItem(LS_AVATAR_KEY, dataUrl);
    return filename;
  },

  /** 删除头像文件；文件不存在不算失败 */
  async removeAvatar(profile: UserProfile): Promise<void> {
    if (isTauriRuntime()) {
      if (!profile.avatarFilename) return;
      const { BaseDirectory, remove } = await import('@tauri-apps/plugin-fs');
      await remove(`${AVATAR_DIR}/${profile.avatarFilename}`, { baseDir: BaseDirectory.AppData });
      return;
    }
    localStorage.removeItem(LS_AVATAR_KEY);
  },
};

/** 压缩到最长边 300px 的 JPEG，避免头像原图直接落盘 */
function compressImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();

    reader.onload = (e) => {
      img.src = e.target?.result as string;

      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const MAX_SIZE = 300;
        let { width, height } = img;

        if (width > height) {
          if (width > MAX_SIZE) {
            height *= MAX_SIZE / width;
            width = MAX_SIZE;
          }
        } else if (height > MAX_SIZE) {
          width *= MAX_SIZE / height;
          height = MAX_SIZE;
        }

        canvas.width = width;
        canvas.height = height;
        ctx?.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('图片压缩失败'))),
          'image/jpeg',
          0.8,
        );
      };

      img.onerror = () => reject(new Error('图片加载失败'));
    };

    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('图片编码失败'));
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(blob);
  });
}

export function useUserProfileTauri(): UseUserProfileReturn {
  const [userProfile, setUserProfile] = useState<UserProfile>(DEFAULT_USER_PROFILE);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  /**
   * 落盘并同步内存态。
   * `avatarDataUrl` 显式传入时直接采用（刚上传完，无需回读磁盘）；
   * 传 undefined 表示"按 profile.avatarFilename 去存储里读"。
   */
  const saveUserProfile = useCallback(
    async (profile: UserProfile, avatarDataUrl?: string | null): Promise<void> => {
      try {
        await profileStore.writeProfile(profile);
      } catch (error) {
        console.error('保存用户资料失败:', error);
        return;
      }

      setUserProfile(profile);

      if (!profile.avatarFilename) {
        setAvatarUrl(null);
        return;
      }
      if (avatarDataUrl !== undefined) {
        setAvatarUrl(avatarDataUrl);
        return;
      }
      try {
        setAvatarUrl(await profileStore.readAvatar(profile));
      } catch (error) {
        console.warn('头像读取失败，已留空:', error);
        setAvatarUrl(null);
      }
    },
    [],
  );

  // 首次加载：没有资料就落一份默认值；读失败也不阻断渲染
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const stored = await profileStore.readProfile();
        if (cancelled) return;
        if (stored) {
          setUserProfile(stored);
          setAvatarUrl(await profileStore.readAvatar(stored));
        } else {
          await saveUserProfile(DEFAULT_USER_PROFILE);
        }
      } catch (error) {
        console.error('加载用户资料失败:', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [saveUserProfile]);

  const updateUserName = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      await saveUserProfile({ ...userProfile, name: trimmed }, avatarUrl);
    },
    [userProfile, avatarUrl, saveUserProfile],
  );

  const updateUserAvatar = useCallback(
    async (file: File): Promise<string> => {
      if (!file.type.startsWith('image/')) {
        throw new Error('请选择图片文件');
      }
      if (file.size > 10 * 1024 * 1024) {
        throw new Error('图片大小不能超过10MB');
      }

      setUploading(true);
      try {
        const dataUrl = await blobToDataUrl(await compressImage(file));
        const filename = await profileStore.writeAvatar(dataUrl);

        // 换新头像后清理旧文件；清理失败不影响主流程
        if (userProfile.avatarFilename && userProfile.avatarFilename !== filename) {
          await profileStore.removeAvatar(userProfile).catch((error) => {
            console.warn('旧头像清理失败:', error);
          });
        }

        await saveUserProfile({ ...userProfile, avatarFilename: filename }, dataUrl);
        return filename;
      } finally {
        setUploading(false);
      }
    },
    [userProfile, saveUserProfile],
  );

  const removeAvatar = useCallback(async () => {
    try {
      await profileStore.removeAvatar(userProfile);
    } catch (error) {
      console.warn('删除头像文件失败:', error);
    }
    await saveUserProfile({ ...userProfile, avatarFilename: null });
  }, [userProfile, saveUserProfile]);

  return {
    userProfile: { ...userProfile, avatarUrl },
    uploading,
    updateUserName,
    updateUserAvatar,
    removeAvatar,
  };
}
