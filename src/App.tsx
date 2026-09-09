import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TaskList } from './pages/TaskList';
import { SchedulePlanner } from './pages/SchedulePlanner';
import { Statistics } from './pages/Statistics';
import { Settings } from './pages/Settings';
import { PluginManager } from './pages/PluginManager';
import { PluginHostProvider, usePluginRoutes } from './plugins/runtime';
import './styles.css';

function App() {
  // 主题 / 页面 / 数据等能力统一由插件宿主管理（不再与主应用硬编码绑定）
  return (
    <PluginHostProvider>
      <ErrorBoundary>
        <AppRoutes />
      </ErrorBoundary>
    </PluginHostProvider>
  );
}

// 置于 Provider 内：需要读取插件宿主贡献的页面列表来生成路由
function AppRoutes() {
  // usePluginRoutes() 返回真正的 <Route> 元素数组，必须直接展开进 <Routes>
  //（React Router 不接受自定义组件作为 <Routes> 的子元素）
  const pluginRouteElements = usePluginRoutes();

  return (
    <Router>
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to="/tasks" replace />} />
          <Route path="/tasks" element={<TaskList />} />
          <Route path="/schedule" element={<SchedulePlanner />} />
          <Route path="/stats" element={<Statistics />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/plugins" element={<PluginManager />} />
          {/* 插件贡献的页面（如"心情日记"插件 -> /mood） */}
          {pluginRouteElements}
          {/* 404 页面 */}
          <Route path="*" element={<div className="text-center py-20">
            <h1 className="text-4xl font-bold text-gray-900 mb-4">404</h1>
            <p className="text-gray-600">页面未找到</p>
          </div>} />
        </Routes>
      </Layout>
    </Router>
  );
}

export default App;
