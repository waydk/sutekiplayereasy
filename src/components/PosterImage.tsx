import { useCallback, useState } from "react";

type PosterImageProps = {
  src: string;
  alt?: string;
  width: number;
  height: number;
  loading?: "eager" | "lazy";
  fetchPriority?: "high" | "low" | "auto";
  className?: string;
};

export function PosterImage({
  src,
  alt = "",
  width,
  height,
  loading = "lazy",
  fetchPriority,
  className,
}: PosterImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const onLoad = useCallback(() => setLoaded(true), []);
  const onError = useCallback(() => {
    setFailed(true);
    setLoaded(true);
  }, []);

  return (
    <span
      className={[
        "poster-img",
        loaded ? "poster-img--loaded" : "poster-img--loading",
        failed ? "poster-img--error" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      {!loaded ? <span className="poster-img__sk" aria-hidden="true" /> : null}
      {!failed ? (
        <img
          src={src}
          alt={alt}
          width={width}
          height={height}
          loading={loading}
          decoding="async"
          fetchPriority={fetchPriority}
          onLoad={onLoad}
          onError={onError}
        />
      ) : null}
    </span>
  );
}
