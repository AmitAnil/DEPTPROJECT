"use client";

import { useResolvedUrl } from '@/lib/storageClient';

/** <img> for a storage reference (sb://...) or plain URL; signs private files on demand. */
export default function StoredImage({ src, alt, className }: { src: string | null | undefined; alt: string; className?: string }) {
    const url = useResolvedUrl(src);
    if (!url) return <div className={`${className ?? ''} bg-gray-100 animate-pulse`} aria-label={alt} />;
    // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived URLs cannot go through next/image
    return <img src={url} alt={alt} className={className} />;
}
