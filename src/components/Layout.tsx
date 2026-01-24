// src/components/Layout.tsx
import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  FaTasks,
  FaSmile,
  FaChartBar,
  FaCog,
  FaBars,
  FaTimes,
  FaHome,
  FaCalendarAlt,
  FaUser,
  FaArrowRight,
  FaPlug,
  FaSpinner
} from 'react-icons/fa';
import { UserProfileModalTauri } from './UserProfileModalTauri';
import { useUserProfileTauri } from '../hooks/useUserProfileTauri';

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const location = useLocation();
  
  const {
    userProfile,
    uploading,
    updateUserName,
    updateUserAvatar,
    removeAvatar
  } = useUserProfileTauri();

  const navigationItems = [
    { path: '/', label: '任务列表', icon: <FaTasks />, exact: true },
    { path: '/mood', label: '心情日记', icon: <FaSmile /> },
    { path: '/stats', label: '数据统计', icon: <FaChartBar /> },
    { path: '/plugins', label: '插件管理', icon: <FaPlug /> }, 
    { path: '/settings', label: '系统设置', icon: <FaCog /> },
  ];

  // 检查是否是当前路径
  const isActive = (path: string, exact: boolean = false) => {
    if (exact) {
      return location.pathname === path;
    }
    return location.pathname.startsWith(path);
  };

  const handleAvatarClick = () => {
    setProfileModalOpen(true);
    setSidebarOpen(false);
  };

  // 监听键盘事件关闭侧边栏
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && sidebarOpen) {
        setSidebarOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [sidebarOpen]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex">
      {/* 移动端菜单按钮 */}
      <div className="lg:hidden fixed top-4 left-4 z-50">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-3 rounded-lg bg-white dark:bg-gray-800 shadow-md hover:shadow-lg transition-shadow"
          aria-label="切换菜单"
        >
          {sidebarOpen ? (
            <FaTimes className="w-5 h-5 text-gray-700 dark:text-gray-300" />
          ) : (
            <FaBars className="w-5 h-5 text-gray-700 dark:text-gray-300" />
          )}
        </button>
      </div>

      {/* 遮罩层（移动端） */}
      {sidebarOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black bg-opacity-50 z-30 transition-opacity"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* 侧边栏 */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-40 w-64 bg-white dark:bg-gray-900 shadow-xl 
          transform transition-transform duration-300 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:translate-x-0 lg:static lg:w-64
        `}
      >
        <div className="h-full flex flex-col">
          {/* Logo 区域 */}
          <div className="p-6 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center">
                <FaHome className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">高山仰止</h1>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">管理任务与心情</p>
              </div>
            </div>
          </div>

          {/* 导航菜单 */}
          <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
            {navigationItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setSidebarOpen(false)}
                className={`
                  flex items-center px-4 py-3 rounded-lg transition-all duration-200
                  ${isActive(item.path, item.exact)
                    ? 'bg-primary-50 dark:bg-blue-900/30 text-primary-600 dark:text-blue-400 shadow-sm'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }
                `}
              >
                <span className={`
                  mr-3 ${isActive(item.path, item.exact) ? 'text-primary-500 dark:text-blue-400' : 'text-gray-400'}
                `}>
                  {item.icon}
                </span>
                <span className="font-medium">{item.label}</span>
              </Link>
            ))}
          </nav>

          {/* 用户信息 */}
          <div className="p-4 border-t border-gray-200 dark:border-gray-700">
            <div 
              className="group cursor-pointer p-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors active:scale-95"
              onClick={handleAvatarClick}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  handleAvatarClick();
                }
              }}
            >
              <div className="flex items-center">
                <div className="relative">
                  <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-gray-300 dark:border-gray-600 group-hover:border-primary-500 transition-colors shadow-md">
                    {userProfile.avatarUrl ? (
                      <img
                        src={userProfile.avatarUrl}
                        alt={userProfile.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                        {uploading ? (
                          <FaSpinner className="w-6 h-6 text-white animate-spin" />
                        ) : (
                          <FaUser className="w-6 h-6 text-white" />
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="ml-3 flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-gray-900 dark:text-gray-100 truncate">
                      {userProfile.name}
                    </p>
                    <FaArrowRight className="w-3 h-3 text-gray-400 group-hover:text-primary-500 transition-colors flex-shrink-0" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* 主内容区 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 顶部导航栏 */}
        <header className="sticky top-0 z-20 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
          <div className="px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 truncate">
                  {navigationItems.find(item => 
                    isActive(item.path, item.exact)
                  )?.label || '欢迎'}
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 truncate">
                  {(() => {
                    const item = navigationItems.find(item => 
                      isActive(item.path, item.exact)
                    );
                    if (item?.label === '任务列表') return '高效管理您的日常任务';
                    if (item?.label === '心情日记') return '记录您的情绪与思考';
                    if (item?.label === '数据统计') return '查看您的生产力分析';
                    if (item?.label === '插件管理') return '扩展应用功能，安装和管理插件'; 
                    if (item?.label === '系统设置') return '个性化您的应用体验';
                    return '';
                  })()}
                </p>
              </div>
              
              {/* 日期显示 */}
              <div className="hidden md:flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400 ml-4">
                <FaCalendarAlt className="w-4 h-4 flex-shrink-0" />
                <span className="truncate max-w-xs">
                  {new Date().toLocaleDateString('zh-CN', { 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric',
                    weekday: 'long'
                  })}
                </span>
              </div>
            </div>
          </div>
        </header>

        {/* 页面内容 */}
        <main className="flex-1 overflow-auto bg-gray-50 dark:bg-gray-900">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
            {children}
          </div>
        </main>

        {/* 页脚 */}
        <footer className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 py-4">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col md:flex-row justify-between items-center text-sm text-gray-500 dark:text-gray-400 space-y-2 md:space-y-0">
              <div>
                © {new Date().getFullYear()} 高山仰止. 保留所有权利.
              </div>
              <div className="flex items-center space-x-4">
                <span className="inline-flex items-center">
                  <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
                  系统运行正常
                </span>
                <button
                  onClick={() => setProfileModalOpen(true)}
                  className="text-primary-600 dark:text-blue-400 hover:text-primary-700 dark:hover:text-blue-300 transition-colors"
                  disabled={uploading}
                >
                  {uploading ? '上传头像中...' : '编辑个人资料'}
                </button>
              </div>
            </div>
          </div>
        </footer>
      </div>

      {/* 用户资料编辑模态框 */}
      <UserProfileModalTauri
        isOpen={profileModalOpen}
        onClose={() => setProfileModalOpen(false)}
        userProfile={userProfile}
        uploading={uploading}
        onUpdateName={updateUserName}
        onUploadAvatar={updateUserAvatar}
        onRemoveAvatar={removeAvatar}
      />
    </div>
  );
};