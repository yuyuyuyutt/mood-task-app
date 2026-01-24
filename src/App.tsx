import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { TaskList } from './pages/TaskList';
import { MoodDiary } from './pages/MoodDiary';
import { Statistics } from './pages/Statistics';
import { Settings } from './pages/Settings';
import { PluginManager } from './pages/PluginManager';
import { useTheme } from './hooks/useTheme';
import './styles.css';

function App() {
  useTheme();

  return (
    <Router>
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to="/tasks" replace />} />
          <Route path="/tasks" element={<TaskList />} />
          <Route path="/mood" element={<MoodDiary />} />
          <Route path="/stats" element={<Statistics />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/plugins" element={<PluginManager />} />
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