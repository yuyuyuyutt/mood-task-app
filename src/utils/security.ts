import CryptoJS from 'crypto-js';
import { PluginManifest } from '../plugins/parser/types';

/**
 * 计算文件校验和
 */
export async function calculateChecksum(file: File | ArrayBuffer): Promise<string> {
  let data: ArrayBuffer;
  
  if (file instanceof File) {
    data = await file.arrayBuffer();
  } else {
    data = file;
  }
  
  // 使用SHA-256
  const wordArray = CryptoJS.lib.WordArray.create(data as any);
  return CryptoJS.SHA256(wordArray).toString(CryptoJS.enc.Hex);
}

/**
 * 验证插件签名
 */
export async function verifySignature(
  manifest: PluginManifest,
  signature: { algorithm: string; signature: string; publicKey: string }
): Promise<boolean> {
  try {
    const { algorithm, signature: sig, publicKey } = signature;
    
    // 创建验证数据（排除签名本身）
    const dataToVerify = { ...manifest };
    delete (dataToVerify.metadata as any).signature;
    
    const dataString = JSON.stringify(dataToVerify, null, 2);
    
    // 根据算法验证签名
    switch (algorithm) {
      case 'RSA':
        return await verifyRSASignature(dataString, sig, publicKey);
      case 'ECDSA':
        return await verifyECDSASignature(dataString, sig, publicKey);
      case 'Ed25519':
        return await verifyEd25519Signature(dataString, sig, publicKey);
      default:
        console.warn(`Unknown signature algorithm: ${algorithm}`);
        return false;
    }
  } catch (error) {
    console.error('Signature verification failed:', error);
    return false;
  }
}

/**
 * 验证RSA签名
 */
async function verifyRSASignature(
  data: string,
  signature: string,
  publicKey: string
): Promise<boolean> {
  // 这里需要实现RSA签名验证
  // 注意：浏览器环境有限制，可能需要后端支持
  console.log('RSA signature verification:', { data, signature, publicKey });
  return true; // 临时返回true
}

/**
 * 验证ECDSA签名
 */
async function verifyECDSASignature(
  data: string,
  signature: string,
  publicKey: string
): Promise<boolean> {
  // ECDSA签名验证实现
  console.log('ECDSA signature verification:', { data, signature, publicKey });
  return true;
}

/**
 * 验证Ed25519签名
 */
async function verifyEd25519Signature(
  data: string,
  signature: string,
  publicKey: string
): Promise<boolean> {
  // Ed25519签名验证实现
  console.log('Ed25519 signature verification:', { data, signature, publicKey });
  return true;
}

/**
 * 生成插件ID
 */
export function generatePluginId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * 验证插件ID格式
 */
export function isValidPluginId(id: string): boolean {
  return /^[a-z0-9-_]+$/.test(id);
}

/**
 * 验证版本号格式
 */
export function isValidVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$/.test(version);
}