// src/components/Layout.tsx
// 应用外壳。视觉层级原则：
// - 导航按"功能重要性"分层：核心工作流（任务/时段/统计）在上，配置类（插件/设置）在下并用分隔线隔开；
// - 页头只保留当前页面标题与日期，不放任何解释性副标题（让组件自己说话）；
// - 全部颜色走语义令牌（canvas/surface/line/ink），深浅色无需分别写两套类名。
import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  FaTasks,
  FaSmile,
  FaChartBar,
  FaCog,
  FaBars,
  FaTimes,
  FaCalendarAlt,
  FaUser,
  FaChevronRight,
  FaPlug,
  FaSpinner,
  FaMoon,
  FaClock,
  FaBookOpen,
} from 'react-icons/fa';
import { UserProfileModalTauri } from './UserProfileModalTauri';
import { useUserProfileTauri } from '../hooks/useUserProfileTauri';
import { usePluginHost } from '../plugins/runtime';
import { Logo } from './Logo';

interface LayoutProps {
  children: React.ReactNode;
}

/** 页面能力图标白名单（与清单 icon 枚举一致；未命中时回退到插件图标） */
const PAGE_ICON_MAP: Record<string, React.ReactNode> = {
  smile: <FaSmile />,
  calendar: <FaCalendarAlt />,
  tasks: <FaTasks />,
  chart: <FaChartBar />,
  plug: <FaPlug />,
  settings: <FaCog />,
  home: <FaTasks />,
  moon: <FaMoon />,
};

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
  exact?: boolean;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const location = useLocation();
  const { pages } = usePluginHost();

  const { userProfile, uploading, updateUserName, updateUserAvatar, removeAvatar } =
    useUserProfileTauri();

  // 核心导航：primary = 高频主功能，secondary = 配置类
  const primaryNav: NavItem[] = [
    { path: '/tasks', label: '任务列表', icon: <FaTasks />, exact: true },
    { path: '/study', label: '学习工作区', icon: <FaBookOpen />, exact: true },
    { path: '/schedule', label: '时段面板', icon: <FaClock />, exact: true },
    { path: '/stats', label: '数据统计', icon: <FaChartBar /> },
  ];
  const secondaryNav: NavItem[] = [
    { path: '/plugins', label: '插件管理', icon: <FaPlug /> },
    { path: '/settings', label: '系统设置', icon: <FaCog /> },
  ];

  // 插件贡献的页面（仅显示 showInNav 的；pageId 冲突时先启用者生效）
  const pluginPages = React.useMemo(() => {
    const seen = new Set<string>();
    const out: NavItem[] = [];
    for (const page of pages) {
      if (!page.showInNav || seen.has(page.pageId)) continue;
      seen.add(page.pageId);
      out.push({
        path: page.path,
        label: page.title,
        icon: PAGE_ICON_MAP[page.icon ?? ''] ?? <FaPlug />,
      });
    }
    return out;
  }, [pages]);

  // 插件页面并入主功能区；路径与核心导航冲突时跳过（核心优先）
  const navSections = React.useMemo(() => {
    const corePaths = new Set([...primaryNav, ...secondaryNav].map((i) => i.path));
    const seen = new Set<string>();
    const extra: NavItem[] = [];
    for (const page of pluginPages) {
      if (corePaths.has(page.path) || seen.has(page.path)) continue;
      seen.add(page.path);
      extra.push(page);
    }
    return { primary: [...primaryNav, ...extra], secondary: secondaryNav };
  }, [pluginPages]);

  const allNavItems: NavItem[] = [...navSections.primary, ...navSections.secondary];

  const isActive = (path: string, exact: boolean = false) =>
    exact ? location.pathname === path : location.pathname.startsWith(path);

  const currentItem = allNavItems.find((item) => isActive(item.path, item.exact));

  const handleAvatarClick = () => {
    setProfileModalOpen(true);
    setSidebarOpen(false);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && sidebarOpen) setSidebarOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [sidebarOpen]);

  const renderNavItem = (item: NavItem) => {
    const active = isActive(item.path, item.exact);
    return (
      <Link
        key={item.path}
        to={item.path}
        onClick={() => setSidebarOpen(false)}
        aria-current={active ? 'page' : undefined}
        className={`group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-all duration-150 ease-snap ${
          active
            ? 'bg-brand-soft font-semibold text-brand-ink'
            : 'font-medium text-ink-2 hover:bg-surface-2 hover:text-ink'
        }`}
      >
        {/* 激活指示条：位置固定，不挤压文字 */}
        <span
          aria-hidden
          className={`absolute top-1/2 -left-2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-brand transition-opacity duration-150 ${
            active ? 'opacity-100' : 'opacity-0'
          }`}
        />
        <span
          className={`flex h-4 w-4 items-center justify-center text-[13px] transition-colors ${
            active ? 'text-brand' : 'text-ink-3 group-hover:text-ink-2'
          }`}
        >
          {item.icon}
        </span>
        <span className="truncate">{item.label}</span>
      </Link>
    );
  };

  return (
    <div className="flex min-h-screen bg-canvas">
      {/* 移动端菜单按钮 */}
      <div className="fixed top-3 left-3 z-50 lg:hidden">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="icon-btn h-9 w-9 border border-line bg-surface shadow-2"
          aria-label="切换菜单"
        >
          {sidebarOpen ? <FaTimes /> : <FaBars />}
        </button>
      </div>

      {/* 移动端遮罩 */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-[2px] transition-opacity lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* 侧边栏 */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-line bg-surface
          transition-transform duration-250 ease-out-expo
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:static lg:translate-x-0`}
      >
        {/* 品牌 */}
        <div className="flex items-center gap-2.5 px-5 pt-5 pb-4">
          <Logo size={30} className="shrink-0 drop-shadow-sm" />
          <span className="truncate text-[15px] font-semibold tracking-tight text-ink">
            Sophotask · 高山仰止
          </span>
        </div>

        {/* 导航：主功能 / 配置 两段 */}
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-4 pb-2">
          {navSections.primary.map(renderNavItem)}

          <div className="px-2.5 pt-3 pb-1.5">
            <div className="h-px bg-line" />
          </div>

          {navSections.secondary.map(renderNavItem)}
        </nav>

        {/* 用户 */}
        <div className="border-t border-line p-3">
          <button
            onClick={handleAvatarClick}
            className="group flex w-full items-center gap-2.5 rounded-lg p-2 text-left transition-colors duration-150 hover:bg-surface-2"
          >
            <span className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-surface-2">
              {userProfile.avatarUrl ? (
                <img
                  src={userProfile.avatarUrl}
                  alt={userProfile.name}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : uploading ? (
                <FaSpinner className="animate-spin text-ink-3" />
              ) : (
                <FaUser className="text-[13px] text-ink-3" />
              )}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
              {userProfile.name}
            </span>
            <FaChevronRight className="shrink-0 text-[10px] text-ink-3 transition-transform duration-150 group-hover:translate-x-0.5" />
          </button>
        </div>
      </aside>

      {/* 主内容区 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur-md">
          <div className="flex items-center justify-between gap-4 px-4 py-3 pl-14 sm:px-6 lg:pl-8">
            <h1 className="truncate text-[15px] font-semibold text-ink">
              {currentItem?.label ?? '每日任务'}
            </h1>
            <div className="flex shrink-0 items-center gap-1.5 text-xs text-ink-3">
              <FaCalendarAlt className="text-[11px]" />
              <span className="tnum">
                {new Date().toLocaleDateString('zh-CN', {
                  month: 'long',
                  day: 'numeric',
                  weekday: 'long',
                })}
              </span>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-auto">
          <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">{children}</div>
        </main>
      </div>

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
