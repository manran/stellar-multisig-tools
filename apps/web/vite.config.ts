import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

const appDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(appDirectory, '../..');

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repositoryRoot, '');
  return {
    plugins: [react(), tailwindcss()],
    publicDir: path.resolve(repositoryRoot, 'public'),
    envDir: repositoryRoot,
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.STELLAR_RPC_PUBLIC_URL': JSON.stringify(env.STELLAR_RPC_PUBLIC_URL || ''),
      'process.env.STELLAR_RPC_TESTNET_URL': JSON.stringify(env.STELLAR_RPC_TESTNET_URL || ''),
      'process.env.STELLAR_SOROBAN_SIMPLE_ACCOUNT_PUBLIC_CONTRACT': JSON.stringify(env.STELLAR_SOROBAN_SIMPLE_ACCOUNT_PUBLIC_CONTRACT || ''),
      'process.env.STELLAR_SOROBAN_SIMPLE_ACCOUNT_PUBLIC_OWNER': JSON.stringify(env.STELLAR_SOROBAN_SIMPLE_ACCOUNT_PUBLIC_OWNER || ''),
      'process.env.STELLAR_SOROBAN_SIMPLE_ACCOUNT_TESTNET_CONTRACT': JSON.stringify(env.STELLAR_SOROBAN_SIMPLE_ACCOUNT_TESTNET_CONTRACT || ''),
      'process.env.STELLAR_SOROBAN_SIMPLE_ACCOUNT_TESTNET_OWNER': JSON.stringify(env.STELLAR_SOROBAN_SIMPLE_ACCOUNT_TESTNET_OWNER || ''),
    },
    resolve: {
      alias: {
        '@': repositoryRoot,
      },
    },
    server: {
      fs: {
        allow: [repositoryRoot],
      },
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
