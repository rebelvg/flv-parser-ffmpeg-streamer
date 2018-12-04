export const config = {
  ffmpegPath: 'C:\\ffmpeg\\ffmpeg.exe',
  mpcPath: 'C:\\Program Files (x86)\\MPC-HC\\mpc-hc.exe',
  videoFile: 'C:\\video.mp4',
  videoStart: '00:00:00',
  pausedImg: 'C:\\paused.png',
  copyVideo: false,
  preset: 'veryfast',
  framerate: 23.976,
  cropHeight: 0,
  scaleWidth: -2,
  videoBitrate: 4000,
  publishLink: 'mpc',
  publishLinks: {
    mpc: '-'
  },
  socketServer: 'http://localhost:3000',
  subtitlesFile: 'C:\\video.srt'
};
