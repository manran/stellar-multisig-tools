import { createMDX } from 'fumadocs-mdx/next';

/** @type {import('next').NextConfig} */
const config = {
  output: 'export',
  reactStrictMode: true,
};

export default createMDX()(config);
