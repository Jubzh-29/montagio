import { comfy } from '@comfyorg/sdk';

// Both lines reach the Comfy Router: the SDK's model namespace and its REST route.
export const viaSdk = () => comfy.models.run('bfl/flux-2-pro', { prompt: 'a cat' });
export const viaHttp = () => fetch('https://api.comfy.org/v2/models/bfl/flux-2-pro', { method: 'POST' });
