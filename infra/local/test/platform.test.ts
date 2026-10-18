import { defaultInstallDir, layout, osOf } from '../src/platform.ts';

test('osOf knows Windows and Linux only', () => {
  expect(osOf('win32')).toBe('windows');
  expect(osOf('linux')).toBe('linux');
  expect(osOf('darwin')).toBeNull();
});

test('MONTAGIO_HOME wins over the default install folder', () => {
  expect(defaultInstallDir('windows', { MONTAGIO_HOME: 'D:\\Montagio', LOCALAPPDATA: 'C:\\L' }, 'C:\\Users\\u')).toBe('D:\\Montagio');
  expect(defaultInstallDir('linux', { MONTAGIO_HOME: '/data/montagio' }, '/home/u')).toBe('/data/montagio');
});

test('the default install folder follows each system', () => {
  expect(defaultInstallDir('windows', { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, 'C:\\Users\\u')).toBe('C:\\Users\\u\\AppData\\Local\\Montagio');
  expect(defaultInstallDir('windows', {}, 'C:\\Users\\u')).toBe('C:\\Users\\u\\AppData\\Local\\Montagio');
  expect(defaultInstallDir('linux', { XDG_DATA_HOME: '/x' }, '/home/u')).toBe('/x/montagio');
  expect(defaultInstallDir('linux', {}, '/home/u')).toBe('/home/u/.local/share/montagio');
});

test('the Windows layout uses Scripts\\*.exe', () => {
  const l = layout('C:\\S R', 'windows');
  expect(l.comfyDir).toBe('C:\\S R\\ComfyUI');
  expect(l.comfyTmp).toBe('C:\\S R\\ComfyUI.tmp');
  expect(l.comfyPython).toBe('C:\\S R\\venvs\\comfyui\\Scripts\\python.exe');
  expect(l.proxyPython).toBe('C:\\S R\\venvs\\comfy-api-proxy\\Scripts\\python.exe');
  expect(l.proxyExe).toBe('C:\\S R\\venvs\\comfy-api-proxy\\Scripts\\comfy-api-proxy.exe');
  expect(l.packLink).toBe('C:\\S R\\ComfyUI\\custom_nodes\\montagio');
  expect(l.modelsDir).toBe('C:\\S R\\ComfyUI\\models');
  expect(l.statePath).toBe('C:\\S R\\install-state.json');
});

test('the Linux layout uses bin/', () => {
  const l = layout('/s', 'linux');
  expect(l).toEqual({
    dir: '/s',
    comfyDir: '/s/ComfyUI',
    comfyTmp: '/s/ComfyUI.tmp',
    comfyVenv: '/s/venvs/comfyui',
    proxyVenv: '/s/venvs/comfy-api-proxy',
    comfyPython: '/s/venvs/comfyui/bin/python',
    proxyPython: '/s/venvs/comfy-api-proxy/bin/python',
    proxyExe: '/s/venvs/comfy-api-proxy/bin/comfy-api-proxy',
    modelsDir: '/s/ComfyUI/models',
    packLink: '/s/ComfyUI/custom_nodes/montagio',
    logsDir: '/s/logs',
    weightsOut: '/s/logs/weights',
    runDir: '/s/run',
    cacheDir: '/s/cache',
    statePath: '/s/install-state.json',
  });
});
