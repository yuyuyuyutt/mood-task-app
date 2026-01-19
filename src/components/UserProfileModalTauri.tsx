import React, { useState, useRef, useEffect } from 'react';
import { 
  FaUser, 
  FaTimes, 
  FaCheck, 
  FaUpload, 
  FaTrash,
  FaSpinner,
  FaImage
} from 'react-icons/fa';

interface UserProfileModalTauriProps {
  isOpen: boolean;
  onClose: () => void;
  userProfile: {
    name: string;
    avatarUrl?: string | null;
  };
  uploading: boolean;
  onUpdateName: (name: string) => Promise<void>;
  onUploadAvatar: (file: File) => Promise<string>;
  onRemoveAvatar: () => Promise<void>;
}

export const UserProfileModalTauri: React.FC<UserProfileModalTauriProps> = ({
  isOpen,
  onClose,
  userProfile,
  uploading,
  onUpdateName,
  onUploadAvatar,
  onRemoveAvatar
}) => {
  const [name, setName] = useState(userProfile.name);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string>('');
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [imageLoadError, setImageLoadError] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  // 初始化
  useEffect(() => {
    if (isOpen) {
      setName(userProfile.name);
      setImageLoadError(false);
    }
  }, [userProfile, isOpen]);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    handleFile(file);
  };

  const handleFile = (file: File | undefined) => {
    if (file) {
      if (!file.type.startsWith('image/')) {
        setError('请选择图片文件（JPG、PNG、GIF等）');
        return;
      }
      
      if (file.size > 10 * 1024 * 1024) {
        setError('图片大小不能超过10MB');
        return;
      }
      
      setSelectedFile(file);
      setError('');
      setUploadProgress(0);
      setImageLoadError(false);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    
    const file = e.dataTransfer.files[0];
    handleFile(file);
  };

  const simulateProgress = () => {
    let progress = 0;
    const interval = setInterval(() => {
      progress += 5 + Math.random() * 15;
      if (progress > 90) {
        clearInterval(interval);
      }
      setUploadProgress(Math.min(progress, 100));
    }, 100);
    
    return () => clearInterval(interval);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    
    setIsProcessing(true);
    const cleanupProgress = simulateProgress();
    
    try {
      await onUploadAvatar(selectedFile);
      setSelectedFile(null);
      setError('');
      setUploadProgress(100);
      
      // 稍等片刻显示完成状态
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      setError(error instanceof Error ? error.message : '上传失败');
    } finally {
      cleanupProgress();
      setIsProcessing(false);
      setUploadProgress(0);
    }
  };

  const handleSaveName = async () => {
    if (name.trim() && name !== userProfile.name) {
      try {
        await onUpdateName(name);
      } catch (error) {
        setError(error instanceof Error ? error.message : '保存失败');
      }
    }
  };

  const handleRemoveAvatar = async () => {
    try {
      await onRemoveAvatar();
      setImageLoadError(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : '删除失败');
    }
  };

  const handleCancelUpload = () => {
    setSelectedFile(null);
  };

  const handleClose = () => {
    // 重置状态
    setSelectedFile(null);
    setError('');
    setUploadProgress(0);
    setIsProcessing(false);
    onClose();
  };

  const handleBackgroundClick = (e: React.MouseEvent) => {
    if (formRef.current && !formRef.current.contains(e.target as Node)) {
      handleClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !isProcessing) {
      handleClose();
    }
  };

  const handleImageError = () => {
    console.error('头像图片加载失败');
    setImageLoadError(true);
  };

  // 获取头像显示内容 - 直接显示已保存的头像
  const getAvatarContent = () => {
    if (!userProfile.avatarUrl || imageLoadError) {
      return (
        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-500 to-purple-600">
          <FaUser className="w-16 h-16 text-white" />
        </div>
      );
    }
    
    return (
      <img
        src={userProfile.avatarUrl}
        alt="头像"
        className="w-full h-full object-cover"
        onError={handleImageError}
        loading="lazy"
      />
    );
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50"
      onClick={handleBackgroundClick}
      onKeyDown={handleKeyDown}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        zIndex: 50,
        padding: '1rem'
      }}
    >
      <div 
        ref={formRef}
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md flex flex-col"
        style={{
          backgroundColor: 'white',
          borderRadius: '0.75rem',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          width: '100%',
          maxWidth: '28rem',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: 'calc(100vh - 2rem)',
          overflow: 'hidden'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 - 固定 */}
        <div className="flex items-center justify-between p-6 border-b dark:border-gray-700 bg-white dark:bg-gray-900">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
            个人资料
          </h2>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
            type="button"
            disabled={isProcessing}
          >
            <FaTimes className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* 表单内容 - 可滚动 */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-6 space-y-6">
            {/* 头像区域 */}
            <div className="flex flex-col items-center">
              <div className="relative mb-4">
                {/* 头像容器 */}
                <div 
                  className={`relative w-32 h-32 rounded-full overflow-hidden border-4 transition-all duration-200 ${
                    isDragging 
                      ? 'border-blue-400 dark:border-blue-300 border-dashed scale-105' 
                      : 'border-gray-200 dark:border-gray-700'
                  }`}
                  onClick={() => !isProcessing && fileInputRef.current?.click()}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  style={{
                    cursor: isProcessing ? 'not-allowed' : 'pointer'
                  }}
                >
                  {/* 当前头像 */}
                  {getAvatarContent()}
                  
                  {/* 拖拽覆盖层 */}
                  {isDragging && (
                    <div className="absolute inset-0 bg-blue-500 bg-opacity-70 flex items-center justify-center">
                      <div className="text-white text-center p-4">
                        <FaUpload className="w-8 h-8 mx-auto mb-2" />
                        <p className="text-sm font-medium">松开以上传图片</p>
                      </div>
                    </div>
                  )}
                </div>
                
                {/* 隐藏的文件输入 */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  style={{ 
                    position: 'absolute',
                    width: 0,
                    height: 0,
                    opacity: 0,
                    pointerEvents: 'none'
                  }}
                  disabled={isProcessing}
                />
              </div>
              
              {/* 上传提示文字 */}
              <p className="text-sm text-gray-600 dark:text-gray-400">
                点击头像区域或拖拽图片上传
              </p>
              
              {/* 头像加载错误提示 */}
              {imageLoadError && (
                <p className="text-sm text-red-500 mt-2">
                  头像加载失败，请重新上传
                </p>
              )}
            </div>

            {/* 上传进度条 */}
            {(uploading || isProcessing) && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-700 dark:text-gray-300">上传进度</span>
                  <span className="font-medium">{uploadProgress}%</span>
                </div>
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                  <div 
                    className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}

            {/* 文件选择和上传按钮 */}
            {selectedFile && !isProcessing && (
              <div className="bg-blue-50 dark:bg-blue-900/30 p-4 rounded-lg">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center">
                    <FaImage className="w-4 h-4 text-blue-500 mr-2" />
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      准备上传新头像
                    </span>
                  </div>
                  <span className="text-xs text-gray-500">
                    {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                  </span>
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
                  {selectedFile.name}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={handleUpload}
                    disabled={uploading}
                    className="flex-1 btn btn-primary flex items-center justify-center"
                  >
                    {uploading ? (
                      <>
                        <FaSpinner className="w-4 h-4 mr-2 animate-spin" />
                        上传中...
                      </>
                    ) : (
                      <>
                        <FaUpload className="w-4 h-4 mr-2" />
                        上传头像
                      </>
                    )}
                  </button>
                  <button
                    onClick={handleCancelUpload}
                    className="btn btn-secondary"
                    type="button"
                  >
                    取消
                  </button>
                </div>
              </div>
            )}

            {/* 删除头像按钮 */}
            {userProfile.avatarUrl && !selectedFile && !isProcessing && !imageLoadError && (
              <button
                onClick={handleRemoveAvatar}
                disabled={isProcessing}
                className="w-full flex items-center justify-center px-4 py-2 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                type="button"
              >
                <FaTrash className="w-4 h-4 mr-2" />
                删除当前头像
              </button>
            )}

            {/* 错误信息 */}
            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-lg text-sm">
                {error}
              </div>
            )}

            {/* 用户名修改 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                用户名
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="flex-1 input dark:bg-gray-800 dark:text-gray-100 dark:border-gray-700"
                  placeholder="请输入用户名"
                  maxLength={20}
                  disabled={isProcessing}
                />
                <button
                  onClick={handleSaveName}
                  disabled={!name.trim() || name === userProfile.name || isProcessing}
                  className="btn btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                  type="button"
                >
                  <FaCheck className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                用户名最多20个字符
              </p>
            </div>

            {/* 使用说明 */}
            <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                使用说明
              </h3>
              <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
                <li>• 支持 JPG、PNG、GIF 等图片格式</li>
                <li>• 图片大小不超过 10MB</li>
                <li>• 上传后会自动压缩优化</li>
                <li>• 头像文件存储在本地磁盘</li>
                <li>• 数据保存在应用数据目录中</li>
              </ul>
            </div>
          </div>
        </div>

        {/* 底部 - 固定 */}
        <div className="p-6 border-t dark:border-gray-700 bg-white dark:bg-gray-900">
          <button
            onClick={handleClose}
            className="w-full btn btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            type="button"
            disabled={isProcessing}
          >
            {isProcessing ? '处理中...' : '完成'}
          </button>
        </div>
      </div>
    </div>
  );
};