import { useCallback, useLayoutEffect, useRef, useState } from "react";

type PosterImageProps = {
  src: string;
  alt?: string;
  width: number;
  height: number;
  loading?: "eager" | "lazy";
  fetchPriority?: "high" | "low" | "auto";
  className?: string;
  /** Без fade — быстрее для постеров above the fold */
  instant?: boolean;
  /** Запасная картинка, если основная не загрузилась. */
  fallbackSrc?: string;
};

export function PosterImage({
  src,
  alt = "",
  width,
  height,
  loading = "lazy",
  fetchPriority,
  className,
  instant = false,
  fallbackSrc,
}: PosterImageProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [currentSrc, setCurrentSrc] = useState(src);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const markLoaded = useCallback(() => setLoaded(true), []);
  const onError = useCallback(() => {
    if (fallbackSrc && currentSrc !== fallbackSrc) {
      setCurrentSrc(fallbackSrc);
      setLoaded(false);
      setFailed(false);
      return;
    }
    setFailed(true);
    setLoaded(true);
  }, [fallbackSrc, currentSrc]);

  useLayoutEffect(() => {
    setCurrentSrc(src);
    setLoaded(false);
    setFailed(false);
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) {
      setLoaded(true);
    }
  }, [src]);

  return (
    <span
      className={[
        "poster-img",
        loaded ? "poster-img--loaded" : "poster-img--loading",
        failed ? "poster-img--error" : "",
        instant ? "poster-img--instant" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      {!loaded ? <span className="poster-img__sk" aria-hidden="true" /> : null}
      {!failed ? (
        <img
          ref={imgRef}
          src={currentSrc}
          alt={alt}
          width={width}
          height={height}
          loading={loading}
          decoding="async"
          fetchPriority={fetchPriority}
          onLoad={markLoaded}
          onError={onError}
        />
      ) : null}
    </span>
  );
}
