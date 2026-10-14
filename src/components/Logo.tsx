// src/components/Logo.tsx
// 品牌标识：右上角折起的纸页（折角形成小三角，折痕有高光与投影，强调立体感）。
// 与 public/logo.svg 同一套几何，内联渲染以便受控尺寸与主题着色。
import React, { useId } from 'react';

interface LogoProps {
  /** 边长（px），默认 32 */
  size?: number;
  className?: string;
  /** 无障碍标签；传空字符串则视为纯装饰 */
  title?: string;
}

export const Logo: React.FC<LogoProps> = ({ size = 32, className, title = 'Sophotask · 高山仰止' }) => {
  // 同一页面可能出现多个实例，渐变 id 必须唯一，否则后一个会覆盖前一个
  const uid = useId().replace(/:/g, '');
  const page = `lp-${uid}`;
  const fold = `lf-${uid}`;
  const crease = `lc-${uid}`;
  const decorative = title === '';

  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={className}
      role={decorative ? 'presentation' : 'img'}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : title}
    >
      <defs>
        <linearGradient id={page} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#7C7BFF" />
          <stop offset="52%" stopColor="#5B55EC" />
          <stop offset="100%" stopColor="#4338CA" />
        </linearGradient>
        <linearGradient id={fold} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#A9A7FF" />
          <stop offset="45%" stopColor="#D6D5FF" />
          <stop offset="100%" stopColor="#FFFFFF" />
        </linearGradient>
        <linearGradient id={crease} x1="0.1" y1="0.1" x2="0.9" y2="0.9">
          <stop offset="0%" stopColor="#312E81" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#312E81" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* 纸面：右上角切掉，其余三角圆角 */}
      <path
        d="M14 6 H28 L42 20 V34 A8 8 0 0 1 34 42 H14 A8 8 0 0 1 6 34 V20 A8 8 0 0 1 14 6 Z"
        fill={`url(#${page})`}
      />
      {/* 折痕内侧投影 */}
      <path d="M28 6 L42 20 L33.5 20 Z" fill={`url(#${crease})`} />
      {/* 折起的小三角 */}
      <path d="M28 6 L28 20 L42 20 Z" fill={`url(#${fold})`} />
      {/* 折痕高光 */}
      <path
        d="M28 6 L42 20"
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity="0.85"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
      {/* 自由角描边 */}
      <path d="M28 20 L42 20" fill="none" stroke="#312E81" strokeOpacity="0.18" strokeWidth="0.9" />
    </svg>
  );
};
