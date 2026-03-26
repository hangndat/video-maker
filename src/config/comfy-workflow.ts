/** API graph node ids — must match workflows/workflow_api.json */
export const COMFY_NODE_LOAD_IMAGE = '6';
export const COMFY_NODE_LOAD_DRIVING_VIDEO = '7';
export const COMFY_NODE_LOAD_AUDIO = '13';
export const COMFY_NODE_VIDEO_COMBINE = '25';

/**
 * Nếu set (vd. id node LoadImage thứ hai sau khi export graph có IP-Adapter),
 * `ComfyService` copy ảnh tham chiếu vào input và gán `inputs[inputKey]`.
 */
export function comfyNodeIpAdapterImageId(): string | undefined {
  const v = process.env.COMFY_NODE_IP_ADAPTER_IMAGE?.trim();
  return v || undefined;
}

/** Tên field input trên node (LoadImage thường là `image`). */
export function comfyNodeIpAdapterImageInputKey(): string {
  const v = process.env.COMFY_NODE_IP_ADAPTER_INPUT_KEY?.trim();
  return v || 'image';
}
