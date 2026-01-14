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

export const Settings: React.FC = () => {
  const [settings, setSettings] = useState({
    // 个人信息
    username: '用户123',
    email: 'user@example.com',
    
    // 通知设置
    notifications: true,
    emailNotifications: false,
    pushNotifications: true,
    soundNotifications: true,
    dailyReminder: true,
    reminderTime: '20:00',
    
    // 显示设置
    theme: 'light' as 'light' | 'dark',
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

  const handleExportData = () => {
    const data = {
      settings,
      exportedAt: new Date().toISOString(),
    };
    
    const dataStr = JSON.stringify(data, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    
    const exportFileDefaultName = `task-manager-backup-${new Date().toISOString().split('T')[0]}.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
    
    setMessage({ type: 'success', text: '数据已导出成功' });
  };

  const handleReset = () => {
    if (window.confirm('确定要重置所有设置为默认值吗？此操作不可撤销。')) {
      const defaultSettings = {
        username: '用户123',
        email: 'user@example.com',
        notifications: true,
        emailNotifications: false,
        pushNotifications: true,
        soundNotifications: true,
        dailyReminder: true,
        reminderTime: '20:00',
        theme: 'light' as 'light' | 'dark',
        language: 'zh-CN',
        fontSize: 'medium' as 'small' | 'medium' | 'large',
        compactMode: false,
        privacyMode: false,
        showEnergyCost: true,
        showMoodPublicly: false,
        autoSave: true,
        backupFrequency: 'weekly' as 'daily' | 'weekly' | 'monthly',
      };
      
      setSettings(defaultSettings);
      setMessage({ type: 'success', text: '设置已重置为默认值' });
    }
  };

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
        {/* 个人信息 */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center mb-6">
            <div className="p-2 bg-blue-50 rounded-lg mr-4">
              <FaUser className="w-5 h-5 text-blue-600" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900">个人信息</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                用户名
              </label>
              <input
                type="text"
                value={settings.username}
                onChange={(e) => handleChange('username', e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                邮箱地址
              </label>
              <input
                type="email"
                value={settings.email}
                onChange={(e) => handleChange('email', e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div className="pt-4 border-t border-gray-200">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                修改密码
              </label>
              <div className="space-y-3">
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={oldPassword}
                    onChange={(e) => setOldPassword(e.target.value)}
                    placeholder="当前密码"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400"
                  >
                    {showPassword ? <FaEyeSlash /> : <FaEye />}
                  </button>
                </div>
                
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="新密码"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="确认新密码"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
          </div>
        </div>

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
              { key: 'emailNotifications', label: '邮件通知', description: '通过邮件接收重要通知' },
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
                  className={`relative inline-flex h-6 w-11 items-center rounded-full ${settings[item.key as keyof typeof settings] ? 'bg-blue-600' : 'bg-gray-200'}`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${settings[item.key as keyof typeof settings] ? 'translate-x-6' : 'translate-x-1'}`}
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
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
        </div>

        {/* 显示设置 */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center mb-6">
            <div className="p-2 bg-purple-50 rounded-lg mr-4">
              <FaPalette className="w-5 h-5 text-purple-600" />
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
                  onClick={() => handleChange('theme', 'light')}
                  className={`flex-1 p-4 border rounded-lg flex flex-col items-center ${settings.theme === 'light' ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}
                >
                  <FaSun className={`w-6 h-6 mb-2 ${settings.theme === 'light' ? 'text-blue-600' : 'text-gray-400'}`} />
                  <span className={`font-medium ${settings.theme === 'light' ? 'text-blue-600' : 'text-gray-600'}`}>浅色模式</span>
                </button>
                <button
                  onClick={() => handleChange('theme', 'dark')}
                  className={`flex-1 p-4 border rounded-lg flex flex-col items-center ${settings.theme === 'dark' ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}
                >
                  <FaMoon className={`w-6 h-6 mb-2 ${settings.theme === 'dark' ? 'text-blue-600' : 'text-gray-400'}`} />
                  <span className={`font-medium ${settings.theme === 'dark' ? 'text-blue-600' : 'text-gray-600'}`}>深色模式</span>
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                字体大小
              </label>
              <div className="flex space-x-2">
                {(['small', 'medium', 'large'] as const).map((size) => (
                  <button
                    key={size}
                    onClick={() => handleChange('fontSize', size)}
                    className={`flex-1 py-2 border rounded-lg ${settings.fontSize === size ? 'border-blue-500 bg-blue-50 text-blue-600' : 'border-gray-200 text-gray-600'}`}
                  >
                    {size === 'small' && '小'}
                    {size === 'medium' && '中'}
                    {size === 'large' && '大'}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                语言
              </label>
              <select
                value={settings.language}
                onChange={(e) => handleChange('language', e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="zh-CN">简体中文</option>
                <option value="en-US">English</option>
                <option value="ja-JP">日本語</option>
                <option value="ko-KR">한국어</option>
              </select>
            </div>

            <div className="flex items-center justify-between py-3">
              <div>
                <div className="font-medium text-gray-900">紧凑模式</div>
                <div className="text-sm text-gray-500">减少界面元素间距</div>
              </div>
              <button
                onClick={() => handleChange('compactMode', !settings.compactMode)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full ${settings.compactMode ? 'bg-blue-600' : 'bg-gray-200'}`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${settings.compactMode ? 'translate-x-6' : 'translate-x-1'}`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* 隐私设置 */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center mb-6">
            <div className="p-2 bg-red-50 rounded-lg mr-4">
              <FaLock className="w-5 h-5 text-red-600" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900">隐私设置</h2>
          </div>

          <div className="space-y-4">
            {[
              { key: 'privacyMode', label: '隐私模式', description: '隐藏敏感信息' },
              { key: 'showEnergyCost', label: '显示能量消耗', description: '在任务卡片上显示能量消耗' },
              { key: 'showMoodPublicly', label: '公开心情记录', description: '允许其他人查看您的心情记录' },
            ].map((item) => (
              <div key={item.key} className="flex items-center justify-between py-3">
                <div>
                  <div className="font-medium text-gray-900">{item.label}</div>
                  <div className="text-sm text-gray-500">{item.description}</div>
                </div>
                <button
                  onClick={() => handleChange(item.key as any, !settings[item.key as keyof typeof settings])}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full ${settings[item.key as keyof typeof settings] ? 'bg-blue-600' : 'bg-gray-200'}`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${settings[item.key as keyof typeof settings] ? 'translate-x-6' : 'translate-x-1'}`}
                  />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* 数据管理 */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center mb-6">
            <div className="p-2 bg-yellow-50 rounded-lg mr-4">
              <FaSave className="w-5 h-5 text-yellow-600" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900">数据管理</h2>
          </div>

          <div className="space-y-6">
            <div className="flex items-center justify-between py-3">
              <div>
                <div className="font-medium text-gray-900">自动保存</div>
                <div className="text-sm text-gray-500">自动保存任务和设置更改</div>
              </div>
              <button
                onClick={() => handleChange('autoSave', !settings.autoSave)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full ${settings.autoSave ? 'bg-blue-600' : 'bg-gray-200'}`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${settings.autoSave ? 'translate-x-6' : 'translate-x-1'}`}
                />
              </button>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                备份频率
              </label>
              <select
                value={settings.backupFrequency}
                onChange={(e) => handleChange('backupFrequency', e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="daily">每天</option>
                <option value="weekly">每周</option>
                <option value="monthly">每月</option>
              </select>
            </div>

            <div className="pt-4 border-t border-gray-200">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <button
                  onClick={handleExportData}
                  className="flex items-center justify-center px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  <FaUpload className="w-4 h-4 mr-2" />
                  导出数据
                </button>
                
                <button
                  onClick={handleReset}
                  className="flex items-center justify-center px-4 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50"
                >
                  <FaTrash className="w-4 h-4 mr-2" />
                  重置设置
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h3 className="font-medium text-gray-900">保存更改</h3>
              <p className="text-sm text-gray-500">应用所有设置更改到您的账户</p>
            </div>
            <button
              onClick={handleSave}
              disabled={saving}
              className="btn btn-primary flex items-center justify-center"
            >
              {saving ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                  保存中...
                </>
              ) : (
                <>
                  <FaSave className="w-4 h-4 mr-2" />
                  保存设置
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};