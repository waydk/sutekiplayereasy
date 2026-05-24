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
}: PosterImageProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const markLoaded = useCallback(() => setLoaded(true), []);
  const onError = useCallback(() => {
    setFailed(true);
    setLoaded(true);
  }, []);

  useLayoutEffect(() => {
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
          src={src}
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
