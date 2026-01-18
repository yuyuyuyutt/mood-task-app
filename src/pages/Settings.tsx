//src/pages/Settings.tsx
import React, { useState } from 'react';
import {
  FaUser,
  FaBell,
  FaPalette,
  FaGlobe,
  FaMoon,
  FaSun,
  FaSave,
  FaLock,
  FaEye,
  FaEyeSlash,
  FaUpload,
  FaTrash,
  FaCheck
} from 'react-icons/fa';
import { useTheme } from '../hooks/useTheme'; // 导入主题 Hook

export const Settings: React.FC = () => {
  const { theme, toggleTheme, setLightTheme, setDarkTheme } = useTheme();
  
  const [settings, setSettings] = useState({
    // 通知设置
    notifications: true,
    emailNotifications: false,
    pushNotifications: true,
    soundNotifications: true,
    dailyReminder: true,
    reminderTime: '20:00',
    
    // 显示设置 - 移除 theme，使用 useTheme Hook 管理
    language: 'zh-CN',
    fontSize: 'medium' as 'small' | 'medium' | 'large',
    compactMode: false,
    
    // 隐私设置
    privacyMode: false,
    showEnergyCost: true,
    showMoodPublicly: false,
    
    // 数据管理
    autoSave: true,
    backupFrequency: 'weekly' as 'daily' | 'weekly' | 'monthly',
  });

  const [showPassword, setShowPassword] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  const handleChange = (key: keyof typeof settings, value: any) => {
    setSettings(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    
    try {
      // 模拟API调用
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 密码修改逻辑
      if (newPassword && newPassword !== confirmPassword) {
        throw new Error('新密码和确认密码不一致');
      }
      
      if (newPassword && newPassword.length < 6) {
        throw new Error('密码长度至少6位');
      }
      
      console.log('保存设置:', settings);
      
      if (newPassword) {
        console.log('密码修改为:', newPassword);
        setOldPassword('');
        setNewPassword('');
        setConfirmPassword('');
      }
      
      setMessage({ type: 'success', text: '设置已保存成功' });
    } catch (error) {
      setMessage({ 
        type: 'error', 
        text: error instanceof Error ? error.message : '保存失败，请重试' 
      });
    } finally {
      setSaving(false);
      
      // 清除消息
      setTimeout(() => {
        setMessage(null);
      }, 3000);
    }
  };

  // 移除 handleThemeChange 函数，改用 useTheme Hook 的方法

  // ... 其他函数保持不变 ...

  return (
    <div className="max-w-4xl mx-auto">
      {/* 头部 */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">设置</h1>
        <p className="text-gray-600 mt-2">
          自定义您的任务管理体验
        </p>
      </div>

      {/* 消息提示 */}
      {message && (
        <div className={`mb-6 p-4 rounded-lg ${message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
          <div className="flex items-center">
            <FaCheck className="w-4 h-4 mr-2" />
            {message.text}
          </div>
        </div>
      )}

      <div className="space-y-8">
        {/* 显示设置 */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center mb-6">
            <div className={`p-2 rounded-lg mr-4 ${theme === 'light' ? 'bg-yellow-50' : 'bg-blue-50'}`}>
              {theme === 'light' ? (
                <FaSun className="w-5 h-5 text-yellow-600" />
              ) : (
                <FaMoon className="w-5 h-5 text-blue-600" />
              )}
            </div>
            <h2 className="text-xl font-semibold text-gray-900">显示设置</h2>
          </div>

          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">
                主题模式
              </label>
              <div className="flex space-x-4">
                <button
                  onClick={setLightTheme}
                  className={`flex-1 p-4 border rounded-lg flex flex-col items-center transition-colors ${theme === 'light' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-300'}`}
                >
                  <FaSun className={`w-6 h-6 mb-2 transition-colors ${theme === 'light' ? 'text-blue-600' : 'text-gray-400'}`} />
                  <span className={`font-medium transition-colors ${theme === 'light' ? 'text-blue-600' : 'text-gray-600'}`}>浅色模式</span>
                </button>
                <button
                  onClick={setDarkTheme}
                  className={`flex-1 p-4 border rounded-lg flex flex-col items-center transition-colors ${theme === 'dark' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-300'}`}
                >
                  <FaMoon className={`w-6 h-6 mb-2 transition-colors ${theme === 'dark' ? 'text-blue-600' : 'text-gray-400'}`} />
                  <span className={`font-medium transition-colors ${theme === 'dark' ? 'text-blue-600' : 'text-gray-600'}`}>深色模式</span>
                </button>
              </div>
              
              {/* 添加切换按钮 */}
              <div className="mt-4 flex items-center justify-between">
                <span className="text-sm text-gray-600">
                  当前主题：{theme === 'light' ? '浅色' : '深色'}
                </span>
                <button
                  onClick={toggleTheme}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center"
                >
                  {theme === 'light' ? (
                    <>
                      <FaMoon className="w-4 h-4 mr-2" />
                      切换到深色
                    </>
                  ) : (
                    <>
                      <FaSun className="w-4 h-4 mr-2" />
                      切换到浅色
                    </>
                  )}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                语言
              </label>
              <select
                value={settings.language}
                onChange={(e) => handleChange('language', e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900"
              >
                <option value="zh-CN">简体中文</option>
                <option value="en-US">English</option>
                <option value="ja-JP">日本語</option>
                <option value="ko-KR">한국어</option>
              </select>
            </div>
          </div>
        </div>

        {/* 其他设置部分保持不变 */}
        {/* 通知设置 */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center mb-6">
            <div className="p-2 bg-green-50 rounded-lg mr-4">
              <FaBell className="w-5 h-5 text-green-600" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900">通知设置</h2>
          </div>

          <div className="space-y-4">
            {[
              { key: 'notifications', label: '启用通知', description: '接收任务提醒和更新' },
              { key: 'pushNotifications', label: '推送通知', description: '在设备上接收推送通知' },
              { key: 'soundNotifications', label: '声音提醒', description: '任务提醒时播放声音' },
              { key: 'dailyReminder', label: '每日提醒', description: '每天提醒待办任务' },
            ].map((item) => (
              <div key={item.key} className="flex items-center justify-between py-3">
                <div>
                  <div className="font-medium text-gray-900">{item.label}</div>
                  <div className="text-sm text-gray-500">{item.description}</div>
                </div>
                <button
                  onClick={() => handleChange(item.key as any, !settings[item.key as keyof typeof settings])}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${settings[item.key as keyof typeof settings] ? 'bg-blue-600' : 'bg-gray-200 hover:bg-gray-300'}`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ${settings[item.key as keyof typeof settings] ? 'translate-x-6' : 'translate-x-1'}`}
                  />
                </button>
              </div>
            ))}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                每日提醒时间
              </label>
              <input
                type="time"
                value={settings.reminderTime}
                onChange={(e) => handleChange('reminderTime', e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};