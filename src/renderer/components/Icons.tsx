import {
  MessageSquare,
  Settings,
  Shield,
  Bot,
  Trash2,
  Edit2,
  Plus,
  X,
  RefreshCw,
  Folder,
  Cpu,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Check,
  ChevronDown,
  Puzzle,
  Activity,
  Search,
  Zap,
  Code2,
  Eye,
  Maximize2,
  Minimize2,
  Link2,
} from 'lucide-react';
import { CSSProperties } from 'react';

interface IconProps {
  size?: number;
  className?: string;
  style?: CSSProperties;
  [key: string]: unknown;
}

export const IconDashboard = ({ size = 24, className = '', ...props }: IconProps) => (
  <Activity size={size} className={className} strokeWidth={1.5} {...props} />
);

export const IconArrowLeft = ({ size = 24, className = '', ...props }: IconProps) => (
  <ArrowLeft size={size} className={className} strokeWidth={1.5} {...props} />
);

export const IconArrowUp = ({ size = 24, className = '', ...props }: IconProps) => (
  <ArrowUp size={size} className={className} strokeWidth={1.5} {...props} />
);

export const IconArrowDown = ({ size = 24, className = '', ...props }: IconProps) => (
  <ArrowDown size={size} className={className} strokeWidth={1.5} {...props} />
);

export const IconCheck = ({ size = 24, className = '', ...props }: IconProps) => (
  <Check size={size} className={className} strokeWidth={1.5} {...props} />
);

export const IconChevronDown = ({ size = 24, className = '', ...props }: IconProps) => (
  <ChevronDown size={size} className={className} strokeWidth={1.5} {...props} />
);


export const IconChat = ({ size = 24, className = '', ...props }: IconProps) => (
  <MessageSquare size={size} className={className} strokeWidth={1.5} {...props} />
);

export const IconCpu = ({ size = 24, className = '', ...props }: IconProps) => (
  <Cpu size={size} className={className} strokeWidth={1.5} {...props} />
);

export const IconSettings = ({ size = 24, className = '', ...props }: IconProps) => (
  <Settings size={size} className={className} strokeWidth={1.5} {...props} />
);

export const IconShield = ({ size = 24, className = '', ...props }: IconProps) => (
  <Shield size={size} className={className} strokeWidth={1.5} {...props} />
);


export const IconBot = ({ size = 24, className = '', ...props }: IconProps) => (
  <Bot size={size} className={className} strokeWidth={1.5} {...props} />
);



export const IconTrash = ({ size = 24, className = '', ...props }: IconProps) => (
  <Trash2 size={size} className={className} strokeWidth={1.5} {...props} />
);

export const IconEdit = ({ size = 24, className = '', ...props }: IconProps) => (
  <Edit2 size={size} className={className} strokeWidth={1.5} {...props} />
);

export const IconPlus = ({ size = 24, className = '', ...props }: IconProps) => (
  <Plus size={size} className={className} strokeWidth={1.5} {...props} />
);

export const IconX = ({ size = 24, className = '', ...props }: IconProps) => (
  <X size={size} className={className} strokeWidth={1.5} {...props} />
);

export const IconRefresh = ({ size = 24, className = '', ...props }: IconProps) => (
  <RefreshCw size={size} className={className} strokeWidth={1.5} {...props} />
);

export const IconFolder = ({ size = 24, className = '', ...props }: IconProps) => (
  <Folder size={size} className={className} strokeWidth={1.5} {...props} />
);

export const IconPlugin = ({ size = 24, className = '', ...props }: IconProps) => (
  <Puzzle size={size} className={className} strokeWidth={1.5} {...props} />
);

export const IconSkill = ({ size = 24, className = '', ...props }: IconProps) => (
  <Zap size={size} className={className} strokeWidth={1.5} {...props} />
);

export const IconSearch = ({ size = 24, className = '', ...props }: IconProps) => (
  <Search size={size} className={className} strokeWidth={1.5} {...props} />
);

export const IconCode = ({ size = 24, className = '', ...props }: IconProps) => (
  <Code2 size={size} className={className} strokeWidth={1.5} {...props} />
);

export const IconPreview = ({ size = 24, className = '', ...props }: IconProps) => (
  <Eye size={size} className={className} strokeWidth={1.5} {...props} />
);

export const IconExpand = ({ size = 24, className = '', ...props }: IconProps) => (
  <Maximize2 size={size} className={className} strokeWidth={1.5} {...props} />
);

export const IconCollapse = ({ size = 24, className = '', ...props }: IconProps) => (
  <Minimize2 size={size} className={className} strokeWidth={1.5} {...props} />
);

export const IconLink = ({ size = 24, className = '', ...props }: IconProps) => (
  <Link2 size={size} className={className} strokeWidth={1.5} {...props} />
);
