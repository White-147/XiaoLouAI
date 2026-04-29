/**
 * BrandIcons.tsx
 * 
 * Custom brand icons for AI providers (OpenAI, Google, Kling, Hailuo/MiniMax, etc.)
 * Uses inline SVGs with currentColor for theme compatibility.
 * Keeps provider brand icons self-contained so the internal canvas runtime can
 * be rebuilt without extra package installs.
 */

import React from 'react';

interface IconProps {
    size?: number;
    className?: string;
}

/**
 * OpenAI Logo Icon (hexagonal flower symbol)
 * Source: Bootstrap Icons
 */
export const OpenAIIcon: React.FC<IconProps> = ({ size = 16, className }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        fill="currentColor"
        viewBox="0 0 16 16"
        className={className}
    >
        <path d="M14.949 6.547a3.94 3.94 0 0 0-.348-3.273 4.11 4.11 0 0 0-4.4-1.934A4.1 4.1 0 0 0 8.423.2 4.15 4.15 0 0 0 6.305.086a4.1 4.1 0 0 0-1.891.948 4.04 4.04 0 0 0-1.158 1.753 4.1 4.1 0 0 0-1.563.679A4 4 0 0 0 .554 4.72a3.99 3.99 0 0 0 .502 4.731 3.94 3.94 0 0 0 .346 3.274 4.11 4.11 0 0 0 4.402 1.933c.382.425.852.764 1.377.995.526.231 1.095.35 1.67.346 1.78.002 3.358-1.132 3.901-2.804a4.1 4.1 0 0 0 1.563-.68 4 4 0 0 0 1.14-1.253 3.99 3.99 0 0 0-.506-4.716m-6.097 8.406a3.05 3.05 0 0 1-1.945-.694l.096-.054 3.23-1.838a.53.53 0 0 0 .265-.455v-4.49l1.366.778q.02.011.025.035v3.722c-.003 1.653-1.361 2.992-3.037 2.996m-6.53-2.75a2.95 2.95 0 0 1-.36-2.01l.095.057L5.29 12.09a.53.53 0 0 0 .527 0l3.949-2.246v1.555a.05.05 0 0 1-.022.041L6.473 13.3c-1.454.826-3.311.335-4.15-1.098m-.85-6.94A3.02 3.02 0 0 1 3.07 3.949v3.785a.51.51 0 0 0 .262.451l3.93 2.237-1.366.779a.05.05 0 0 1-.048 0L2.585 9.342a2.98 2.98 0 0 1-1.113-4.094zm11.216 2.571L8.747 5.576l1.362-.776a.05.05 0 0 1 .048 0l3.265 1.86a3 3 0 0 1 1.173 1.207 2.96 2.96 0 0 1-.27 3.2 3.05 3.05 0 0 1-1.36.997V8.279a.52.52 0 0 0-.276-.445m1.36-2.015-.097-.057-3.226-1.855a.53.53 0 0 0-.53 0L6.249 6.153V4.598a.04.04 0 0 1 .019-.04L9.533 2.7a3.07 3.07 0 0 1 3.257.139c.474.325.843.778 1.066 1.303.223.526.289 1.103.191 1.664zM5.503 8.575 4.139 7.8a.05.05 0 0 1-.026-.037V4.049c0-.57.166-1.127.476-1.607s.752-.864 1.275-1.105a3.08 3.08 0 0 1 3.234.41l-.096.054-3.23 1.838a.53.53 0 0 0-.265.455zm.742-1.577 1.758-1 1.762 1v2l-1.755 1-1.762-1z" />
    </svg>
);

/**
 * Google Logo Icon
 * Source: User provided SVG
 */
export const GoogleIcon: React.FC<IconProps> = ({ size = 16, className }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        fill="currentColor"
        viewBox="0 0 16 16"
        className={className}
    >
        <path d="M15.545 6.558a9.4 9.4 0 0 1 .139 1.626c0 2.434-.87 4.492-2.384 5.885h.002C11.978 15.292 10.158 16 8 16A8 8 0 1 1 8 0a7.7 7.7 0 0 1 5.352 2.082l-2.284 2.284A4.35 4.35 0 0 0 8 3.166c-2.087 0-3.86 1.408-4.492 3.304a4.8 4.8 0 0 0 0 3.063h.003c.635 1.893 2.405 3.301 4.492 3.301 1.078 0 2.004-.276 2.722-.764h-.003a3.7 3.7 0 0 0 1.599-2.431H8v-3.08z" />
    </svg>
);

export const GeminiIcon: React.FC<IconProps> = ({ size = 16, className }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        className={className}
    >
        <path
            d="M12 2.25c1.1 5.12 4.63 8.65 9.75 9.75-5.12 1.1-8.65 4.63-9.75 9.75-1.1-5.12-4.63-8.65-9.75-9.75 5.12-1.1 8.65-4.63 9.75-9.75Z"
            fill="currentColor"
        />
    </svg>
);

export const BlackForestLabsIcon: React.FC<IconProps> = ({ size = 16, className }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 196 140"
        fill="none"
        className={className}
    >
        <path
            d="M139.757 59.839h-20.846L98.065 30.472 33.038 121.982h20.89l44.136-62.141H118.91l-44.137 62.141h20.949l44.035-62.143L196 139.025h-15.732v.001h-17.175v-16.977l-23.336-32.843-23.206 32.78v17.039H62.668v.002H41.821v-.002H0L98.065.974l41.692 58.865Z"
            fill="currentColor"
        />
    </svg>
);

export const SeedIcon: React.FC<IconProps> = ({ size = 16, className }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="currentColor"
        className={className}
    >
        <rect x="2" y="8" width="3" height="6" rx="1" />
        <rect x="6.5" y="4" width="3" height="10" rx="1" />
        <rect x="11" y="1" width="3" height="13" rx="1" />
    </svg>
);

export const QwenIcon: React.FC<IconProps> = ({ size = 16, className }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={className}
    >
        <path
            d="M12 1.6 20.4 6v7.9L12 22.4l-8.4-8.5V6L12 1.6Z"
            fill="currentColor"
        />
        <path
            d="M7.15 7.1h9.55l-1.95 2.35H9.2l2.75 3.1-1.62 2.05-4.45-5.18 1.27-2.32Zm9.88 4.16-1.54 2.1 2.1 2.55h-3.23L11.1 12.1l1.55-2.05 4.38 1.21Z"
            fill="white"
        />
    </svg>
);

export const PixVerseIcon: React.FC<IconProps> = ({ size = 16, className }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        className={className}
    >
        <path d="M2.2 2.2h5.9c3.4 0 5.7 2.3 5.7 5.8s-2.3 5.8-5.7 5.8H2.2V2.2Zm3.1 2.7v6.2h2.6c1.7 0 2.8-1.2 2.8-3.1S9.6 4.9 7.9 4.9H5.3Z" fill="currentColor" />
    </svg>
);

export const KlingMonoIcon: React.FC<IconProps> = ({ size = 16, className }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="currentColor"
        className={className}
    >
        <path d="M3 2.75h2.45v4.22l4.2-4.22h3.05L7.9 7.55l5.1 5.7H9.8L5.45 8.38v4.87H3V2.75Z" />
    </svg>
);

export const KlingIcon: React.FC<IconProps> = ({ size = 16, className }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 16 16"
        className={className}
    >
        <defs>
            <linearGradient id="kling-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#7C3AED" />
                <stop offset="100%" stopColor="#EC4899" />
            </linearGradient>
        </defs>
        <rect x="1.5" y="1.5" width="13" height="13" rx="4" fill="url(#kling-gradient)" />
        <path d="M5 4.25v7.5h1.75V8.55l3.3 3.2h2.25L8.4 7.95l3.6-3.7H9.8L6.75 7.3V4.25z" fill="#fff" />
    </svg>
);

export const HailuoIcon: React.FC<IconProps> = ({ size = 16, className }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 16 16"
        className={className}
    >
        <defs>
            <linearGradient id="hailuo-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#14B8A6" />
                <stop offset="100%" stopColor="#06B6D4" />
            </linearGradient>
        </defs>
        <circle cx="8" cy="8" r="6.5" fill="url(#hailuo-gradient)" />
        <path d="M5 4.5h1.6v2.6h2.8V4.5H11v7H9.4V8.55H6.6v2.95H5z" fill="#fff" />
    </svg>
);
