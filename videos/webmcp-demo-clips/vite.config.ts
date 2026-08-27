import {defineConfig} from 'vite';
import motionCanvas from '@motion-canvas/vite-plugin';
import ffmpeg from '@motion-canvas/ffmpeg/lib/server';

export default defineConfig({
  plugins: [
    motionCanvas({
      output: './output',
      project: './src/project.ts',
    }),
    ffmpeg(),
  ],
});
