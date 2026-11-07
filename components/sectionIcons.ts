import {
    AlignLeft, BarChart3, BookOpen, Calendar, Camera, ClipboardCheck, FileText, Image, ListChecks, Paperclip, ShieldCheck, Star, UserCircle, Users,
    type LucideIcon,
} from 'lucide-react';
import type { SectionIcon } from '@/lib/template';

export const SECTION_ICON_COMPONENTS: Record<SectionIcon, LucideIcon> = {
    'file-text': FileText,
    user: UserCircle,
    users: Users,
    'align-left': AlignLeft,
    clipboard: ClipboardCheck,
    camera: Camera,
    list: ListChecks,
    book: BookOpen,
    shield: ShieldCheck,
    chart: BarChart3,
    calendar: Calendar,
    image: Image,
    paperclip: Paperclip,
    star: Star,
};

export const iconFor = (icon: SectionIcon | undefined): LucideIcon => (icon ? SECTION_ICON_COMPONENTS[icon] : FileText);
