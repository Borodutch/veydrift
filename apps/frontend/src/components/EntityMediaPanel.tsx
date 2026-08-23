import { useEffect, useMemo, useState } from "preact/hooks";
import {
  entityMediaEmbedUrl,
  nextEntityMediaPlaybackState,
  type EntityMediaKind,
  type EntityMediaRecord,
  type EntityMediaPlaybackState,
  type EntityMediaResponse,
} from "../entityMedia";
import { backendDataStoreFor } from "../backendDataStore";
import { useBackendDataQuery } from "../useBackendDataQuery";
import { playableApiUrl } from "../runtimeConfig";
import type { Eip1193Provider } from "../walletFlow";
import { Skeleton, SkeletonRegion } from "./Skeleton";

export function EntityMediaPanel({
  account,
  apiBaseUrl = playableApiUrl,
  canEdit = false,
  entityId,
  entityKind,
  provider,
}: {
  account?: string | undefined;
  apiBaseUrl?: string | undefined;
  canEdit?: boolean | undefined;
  entityId: string;
  entityKind: EntityMediaKind;
  provider?: Eip1193Provider | undefined;
}) {
  const normalizedApiUrl = apiBaseUrl || playableApiUrl;
  const entityKey = `${entityKind}:${entityKind === "player" ? entityId.toLowerCase() : entityId}`;
  const [editorOpen, setEditorOpen] = useState(false);
  const [mediaUrl, setMediaUrl] = useState("");
  const [action, setAction] = useState<{ status: "idle" | "pending" | "success" | "error"; label?: string }>({ status: "idle" });
  const [playback, setPlayback] = useState<EntityMediaPlaybackState>({ enabled: true, entityKey });
  const heading = entityMediaHeading(entityKind);
  const backendData = useMemo(() => backendDataStoreFor(normalizedApiUrl), [normalizedApiUrl]);
  const mediaQuery = useBackendDataQuery<EntityMediaResponse>(
    backendData.queries.entityMedia(entityKind, entityId),
  );
  const response = mediaQuery.snapshot?.data;
  const record = response?.media ?? null;
  const loading = mediaQuery.snapshot?.freshness === "refreshing" && response === undefined;
  const loadError = mediaQuery.snapshot?.error ?? null;

  useEffect(() => {
    setPlayback((current) => nextEntityMediaPlaybackState(current, entityKey, "sync-entity"));
    setMediaUrl(record?.media.canonicalUrl ?? "");
  }, [entityKey, record?.media.canonicalUrl]);

  const embedUrl = useMemo(
    () => record ? entityMediaEmbedUrl(record.media) : null,
    [record?.media.id, record?.media.type]
  );

  const save = async (nextUrl: string) => {
    if (!account || !provider) {
      setAction({ status: "error", label: "Connect the owning wallet to update media." });
      return;
    }
    setAction({ status: "pending", label: "Waiting for wallet signature" });
    try {
      const response = await backendData.saveEntityMedia(
        provider,
        account,
        entityKind,
        entityId,
        nextUrl
      );
      setMediaUrl(response.media?.media.canonicalUrl ?? "");
      setEditorOpen(false);
      setAction({
        status: "success",
        label: response.media ? "Media saved." : "Media removed.",
      });
    } catch (error) {
      setAction({
        status: "error",
        label: error instanceof Error ? error.message : "Media could not be saved.",
      });
    }
  };

  if (loading) return <EntityMediaPanelSkeleton canEdit={canEdit} heading={heading} />;
  if (!record && !canEdit) return null;

  return (
    <section className="rounded-lg border border-cyan-300/20 bg-black/30 p-3" aria-label={heading}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">{heading}</h3>
        <div className="flex flex-wrap gap-2">
          {record ? (
            <button
              className="min-h-11 rounded border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/10 xl:min-h-0"
              onClick={() => setPlayback((current) => nextEntityMediaPlaybackState(current, entityKey, current.enabled ? "turn-off" : "turn-on"))}
              type="button"
            >
              {playback.enabled ? "Turn media off" : "Turn media on"}
            </button>
          ) : null}
          {canEdit ? (
            <button
              className="min-h-11 rounded border border-cyan-300/25 bg-cyan-300/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/15 xl:min-h-0"
              onClick={() => setEditorOpen((current) => !current)}
              type="button"
            >
              {record ? "Edit media" : "Add media"}
            </button>
          ) : null}
        </div>
      </div>

      {record && playback.enabled && embedUrl ? (
        <div className="mt-3 aspect-video overflow-hidden rounded border border-white/10 bg-black">
          <iframe
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            className="h-full w-full"
            loading="eager"
            referrerPolicy="strict-origin-when-cross-origin"
            src={embedUrl}
            title={`YouTube ${record.media.type}`}
          />
        </div>
      ) : null}
      {record && !playback.enabled ? (
        <p className="mt-3 rounded border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-400">
          Media is off for this page visit.
        </p>
      ) : null}

      {editorOpen ? (
        <form
          className="mt-3 grid gap-2 rounded border border-white/10 bg-black/20 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save(mediaUrl);
          }}
        >
          <label className="text-xs font-semibold text-slate-300" htmlFor={`entity-media-${entityKey}`}>
            YouTube video or playlist URL
          </label>
          <input
            className="min-w-0 rounded border border-white/15 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/50"
            id={`entity-media-${entityKey}`}
            onInput={(event) => setMediaUrl(event.currentTarget.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            type="url"
            value={mediaUrl}
          />
          <div className="flex flex-wrap gap-2">
            <button
              className="min-h-11 rounded border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-sm font-semibold text-cyan-100 disabled:opacity-50 xl:min-h-0"
              disabled={action.status === "pending" || !mediaUrl.trim()}
              type="submit"
            >
              {record ? "Replace media" : "Save media"}
            </button>
            {record ? (
              <button
                className="min-h-11 rounded border border-red-300/25 px-3 py-2 text-sm font-semibold text-red-100 disabled:opacity-50 xl:min-h-0"
                disabled={action.status === "pending"}
                onClick={() => void save("")}
                type="button"
              >
                Remove media
              </button>
            ) : null}
          </div>
        </form>
      ) : null}

      {loadError && canEdit ? <p className="mt-2 text-xs text-amber-100">{loadError}</p> : null}
      {action.status !== "idle" && action.label ? (
        <p
          className={`mt-2 text-xs ${
            action.status === "error"
              ? "text-red-200"
              : action.status === "success"
                ? "text-emerald-200"
                : "text-cyan-100"
          }`}
          role={action.status === "error" ? "alert" : "status"}
        >
          {action.label}
        </p>
      ) : null}
    </section>
  );
}

export function EntityMediaPanelSkeleton({
  canEdit = false,
  heading,
}: {
  canEdit?: boolean | undefined;
  heading: string;
}) {
  return (
    <section className="rounded-lg border border-cyan-300/20 bg-black/30 p-3" aria-label={heading}>
      <SkeletonRegion className="flex items-center justify-between gap-3" label={`Loading ${heading.toLowerCase()}`}>
        <Skeleton className="h-4 w-28" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-24 rounded" />
          {canEdit ? <Skeleton className="h-8 w-20 rounded" /> : null}
        </div>
      </SkeletonRegion>
    </section>
  );
}

export function entityMediaHeading(entityKind: EntityMediaKind): string {
  if (entityKind === "planet") return "Planet anthem";
  if (entityKind === "moon") return "Moon anthem";
  if (entityKind === "player") return "Player media";
  return "Alliance media";
}
