
export enum NodeType {
  TEXT = 'Text',
  IMAGE = 'Image',
  VIDEO = 'Video',
  AUDIO = 'Audio',
  IMAGE_EDITOR = 'Image Editor',
  VIDEO_EDITOR = 'Video Editor',
  STORYBOARD = 'Storyboard Manager',
  CAMERA_ANGLE = 'Camera Angle',
  // Local open-source model nodes
  LOCAL_IMAGE_MODEL = 'Local Image Model',
  LOCAL_VIDEO_MODEL = 'Local Video Model'
}

export enum NodeStatus {
  IDLE = 'idle',
  LOADING = 'loading',
  SUCCESS = 'success',
  ERROR = 'error'
}

export interface NodeData {
  id: string;
  type: NodeType;
  title?: string; // Custom title for the node (defaults to type if not set)
  x: number;
  y: number;
  // Explicit render width (in canvas world px) set by the user when they drag
  // the corner resize handles. When undefined, CanvasNode falls back to the
  // type-specific default (see utils/nodeGeometry.ts). Height is always
  // derived from width + aspect ratio, so we never persist it directly.
  width?: number;
  prompt: string;
  status: NodeStatus;
  loadingKind?: 'generation' | 'asset-upload';
  resultUrl?: string; // Image URL or Video URL
  lastFrame?: string; // For Video nodes: base64/url of the last frame to use as input for next node
  parentIds?: string[]; // For connecting lines (supports multiple inputs)
  groupId?: string; // ID of the group this node belongs to
  errorMessage?: string;

  // Text node specific
  textMode?: 'menu' | 'editing'; // For Text nodes: current mode
  linkedVideoNodeId?: string; // For Text nodes: linked video node for prompt sync

  // Video node specific
  videoMode?: 'standard' | 'frame-to-frame' | 'multi-reference' | 'motion-control' | 'video-edit' | 'video-extend'; // Video generation mode
  frameInputs?: { nodeId: string; order: 'start' | 'end' }[]; // For frame-to-frame: connected image nodes
  videoModel?: string; // Video model version (e.g., 'veo-3.1', 'kling-v2-1')
  videoDuration?: number; // Video duration in seconds (e.g., 5, 6, 8, 10)
  generateAudio?: boolean; // Whether to generate native audio (Seedance 2.0, Kling 2.6)
  networkSearch?: boolean; // Whether to enhance prompt with web search results
  inputUrl?: string; // Input URL for video generation (image-to-video)
  referenceVideoUrls?: string[];
  referenceAudioUrls?: string[];
  editMode?: string;
  editPresetId?: string;
  motionReferenceVideoUrl?: string;
  characterReferenceImageUrl?: string;
  qualityMode?: string;

  // Video Editor specific
  trimStart?: number; // Trim start time in seconds
  trimEnd?: number; // Trim end time in seconds

  // Settings
  model: string;
  imageModel?: string; // Image model version (e.g., 'gemini-3-pro-image-preview', 'kling-v2-1')
  aspectRatio: string;
  resolution: string;
  batchCount?: number; // Number of images to generate in one batch (1-10)
  isPromptExpanded?: boolean; // Whether the prompt editing area is expanded
  resultAspectRatio?: string; // Actual aspect ratio of the generated image (e.g., '16/9')
  generationStartTime?: number; // Timestamp when generation started (for recovery race condition prevention)
  // Task ID of the in-flight / last-completed generation. Persisted so a
  // canvas reloaded in a new session/tab can recover the result even if the
  // original polling promise was lost when the component unmounted.
  taskId?: string;

  // Image Editor state persistence
  editorElements?: Array<{
    id: string;
    type: 'arrow' | 'text';
    // Arrow properties
    startX?: number;
    startY?: number;
    endX?: number;
    endY?: number;
    color?: string;
    lineWidth?: number;
    // Text properties
    x?: number;
    y?: number;
    text?: string;
    fontSize?: number;
    fontFamily?: string;
  }>; // Elements (arrows, text) drawn in image editor
  editorCanvasData?: string; // Base64 brush/eraser canvas data
  editorCanvasSize?: { width: number; height: number }; // Size of the canvas when elements were saved (for scaling)
  editorBackgroundUrl?: string; // Clean background image URL (without elements) for re-editing

  // Change Angle mode (Image nodes only)
  angleMode?: boolean; // Whether the node is in angle editing mode
  angleSettings?: {
    mode?: 'subject' | 'camera';
    rotation: number;  // Horizontal rotation in degrees (-180 to 180)
    tilt: number;      // Vertical tilt in degrees (-90 to 90)
    scale: number;     // Scale factor (0 to 100)
    wideAngle: boolean; // Whether to use wide-angle lens perspective
  };

  // Local Model node specific
  localModelId?: string;        // ID of the selected local model
  localModelPath?: string;      // Absolute path to model file on disk
  localModelType?: 'diffusion' | 'controlnet' | 'lora' | 'camera-control';
  localModelArchitecture?: string; // Model architecture (e.g., 'sd15', 'sdxl', 'qwen')

  // Storyboard Generator specific
  characterReferenceUrls?: string[]; // URLs of character images for reference in generation
}

export interface ContextMenuState {
  isOpen: boolean;
  x: number;
  y: number;
  type: 'global' | 'node-connector' | 'node-options' | 'add-nodes'; // 'global' = right click on canvas, 'add-nodes' = double click
  sourceNodeId?: string; // If 'node-connector' or 'node-options', which node originated the click
  connectorSide?: 'left' | 'right';
  placeNodeAtMenuPosition?: boolean; // For drag-to-empty connector drops.
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface SelectionBox {
  isActive: boolean;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export interface NodeGroup {
  id: string;
  nodeIds: string[];
  label: string;
  storyContext?: {
    story: string;
    scripts: any[];
    selectedCharacters?: any[]; // CharacterAsset[]
    sceneCount?: number;
    styleAnchor?: string;
    characterDNA?: Record<string, string>;
    compositeImageUrl?: string | null;
  };
}

// ─── Unified media capability types (bridge-compatible with XIAOLOU-main) ───

export type CanvasNodeUploadSource = string | File;

export type BridgeMediaKind = 'image' | 'video';
export type BridgeMediaModelProvider = 'google' | 'google-vertex' | 'kling' | 'openai' | 'volcengine' | 'hailuo' | 'grok' | 'bytedance' | 'pixverse' | 'other';
export type BridgeMediaModelStatus = 'stable' | 'experimental' | 'failing' | 'preview' | 'untested';
export type BridgeImageInputMode = 'text_to_image' | 'image_to_image' | 'multi_image';
export type BridgeVideoInputMode = 'text_to_video' | 'single_reference' | 'start_end_frame' | 'multi_param' | 'video_reference' | 'video_edit' | 'motion_control' | 'video_extend';
export type BridgeMediaInputMode = BridgeImageInputMode | BridgeVideoInputMode;

export interface BridgeMediaCapabilitySet {
  supported: boolean;
  status: BridgeMediaModelStatus;
  supportedAspectRatios: string[];
  supportedResolutions: string[];
  supportedDurations?: string[];
  durationControl?: 'none' | 'fixed' | 'selectable';
  aspectRatioControl?: 'none' | 'fixed' | 'selectable';
  resolutionControl?: 'none' | 'fixed' | 'selectable';
  defaultAspectRatio?: string | null;
  defaultResolution?: string | null;
  defaultDuration?: string | null;
  maxReferenceImages?: number;
  maxReferenceVideos?: number;
  maxReferenceAudios?: number;
  qualityModes?: string[];
  editModes?: string[];
  requires?: string[];
  note?: string | null;
}

export interface BridgeMediaModelCapability {
  id: string;
  label: string;
  provider: BridgeMediaModelProvider;
  kind: BridgeMediaKind;
  status: BridgeMediaModelStatus;
  note?: string | null;
  recommended?: boolean;
  maxReferenceImages?: number;
  maxReferenceVideos?: number;
  maxReferenceAudios?: number;
  inputModes: Partial<Record<BridgeMediaInputMode, BridgeMediaCapabilitySet>>;
}

export interface BridgeMediaCapabilitiesResponse {
  kind: BridgeMediaKind;
  mode: string;
  defaultModel?: string | null;
  items: BridgeMediaModelCapability[];
}
