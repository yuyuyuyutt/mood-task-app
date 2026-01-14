// src/components/Layout.tsx
import React, { useState } from 'react';
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
  FaCheckCircle
} from 'react-icons/fa';

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  const navigationItems = [
    { path: '/', label: '任务管理', icon: <FaTasks />, exact: true },
    { path: '/tasks', label: '任务列表', icon: <FaCheckCircle /> },
    { path: '/mood', label: '心情日记', icon: <FaSmile /> },
    { path: '/stats', label: '数据统计', icon: <FaChartBar /> },
    { path: '/settings', label: '系统设置', icon: <FaCog /> },
  ];

  // 检查是否是当前路径
  const isActive = (path: string, exact: boolean = false) => {
    if (exact) {
      return location.pathname === path;
    }
    return location.pathname.startsWith(path);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* 移动端菜单按钮 */}
      <div className="lg:hidden fixed top-4 left-4 z-50">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-3 rounded-lg bg-white shadow-md hover:shadow-lg transition-shadow"
          aria-label="切换菜单"
        >
          {sidebarOpen ? (
            <FaTimes className="w-5 h-5 text-gray-700" />
          ) : (
            <FaBars className="w-5 h-5 text-gray-700" />
          )}
        </button>
      </div>

      {/* 遮罩层（移动端） */}
      {sidebarOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black bg-opacity-50 z-30"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* 侧边栏 */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-40 w-64 bg-white shadow-xl 
          transform transition-transform duration-300 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:translate-x-0 lg:static lg:w-64
        `}
      >
        <div className="h-full flex flex-col">
          {/* Logo 区域 */}
          <div className="p-6 border-b border-gray-200">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center">
                <FaHome className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">生产力助手</h1>
                <p className="text-sm text-gray-500 mt-1">管理任务与心情</p>
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
                    ? 'bg-primary-50 text-primary-600 shadow-sm'
                    : 'text-gray-700 hover:bg-gray-100'
                  }
                `}
              >
                <span className={`
                  mr-3 ${isActive(item.path, item.exact) ? 'text-primary-500' : 'text-gray-400'}
                `}>
                  {item.icon}
                </span>
                <span className="font-medium">{item.label}</span>
              </Link>
            ))}
          </nav>

          {/* 用户信息 */}
          <div className="p-4 border-t border-gray-200">
            <div className="flex items-center">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                <span className="text-white font-medium text-sm">用户</span>
              </div>
              <div className="ml-3 flex-1">
                <p className="font-medium text-gray-900">当前用户</p>
                <p className="text-sm text-gray-500">欢迎使用</p>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* 主内容区 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 顶部导航栏 */}
        <header className="sticky top-0 z-20 bg-white border-b border-gray-200">
          <div className="px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">
                  {navigationItems.find(item => 
                    isActive(item.path, item.exact)
                  )?.label || '欢迎'}
                </h2>
                <p className="text-sm text-gray-600 mt-1">
                  {(() => {
                    const item = navigationItems.find(item => 
                      isActive(item.path, item.exact)
                    );
                    if (item?.label === '任务管理') return '高效管理您的日常任务';
                    if (item?.label === '心情日记') return '记录您的情绪与思考';
                    if (item?.label === '数据统计') return '查看您的生产力分析';
                    if (item?.label === '系统设置') return '个性化您的应用体验';
                    return '';
                  })()}
                </p>
              </div>
              
              {/* 日期显示 */}
              <div className="hidden md:flex items-center space-x-2 text-sm text-gray-600">
                <FaCalendarAlt className="w-4 h-4" />
                <span>{new Date().toLocaleDateString('zh-CN', { 
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric',
                  weekday: 'long'
                })}</span>
              </div>
            </div>
          </div>
        </header>

        {/* 页面内容 */}
        <main className="flex-1 overflow-auto">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
            {children}
          </div>
        </main>

        {/* 页脚 */}
        <footer className="border-t border-gray-200 bg-white py-4">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col md:flex-row justify-between items-center text-sm text-gray-500">
              <div className="mb-2 md:mb-0">
                © {new Date().getFullYear()} 生产力助手. 保留所有权利.
              </div>
              <div className="flex items-center space-x-4">
                <span className="inline-flex items-center">
                  <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
                  系统运行正常
                </span>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
};