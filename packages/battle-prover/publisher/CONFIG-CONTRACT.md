# Publisher configuration v1

Schema string: veydrift.proof-publisher.v1. Top-level field order is exact Go json.Marshal(Config): Schema,StoreRoot,ArtifactRoot,AuthorityRoot,Catalog,Source,Limits,MaxJobBytes,MaxExportBytes. No newline, unknown/duplicate/omitted fields, aliases or alternate encoding. CLI LoadConfig requires absolute canonical path and external SHA256 of the ENTIRE document; the publisher executable has a separate deployment-owner pin. No self-approval or example production pins.

Catalog exact frozen runtime.CatalogConfig fields: Root,ManifestPath,TrustedManifestSHA256,MaxManifestBytes,MaxArtifactBytes.
Source exact frozen chainsource.Config fields: URL,ChainID,Game,DeploymentBlock,Release,BlockPage,FleetPage,MaxPages,MaxFleetReads,MaxLogs,MaxRows,MaxInputBytes,MaxResponseBytes.
Release fields: Version,Rules,Catalog,Verifier,VerifierCodehash,Engine,VerifierManifest.
Limits exact runtime.ArtifactLimits fields: MaxVKBytes,MaxInputBytes,MaxArtifactBytes,MaxProofBytes,MaxLeaves.

Use actual exported Go struct to encode final approved config after source/binary review; preserve nested struct encoding rather than hand-inventing JSON. Strings/integers follow those types, unlike all-string authority records. Source.Release.VerifierManifest MUST equal Catalog.TrustedManifestSHA256. Rules and onchainCatalog are linked protocol commitments, not hashes of prose. Source has approved real RPC URL only when execution is authorized; no credentials/query/fragment, no default URL. No live RPC is needed for action validate, which does not confer source/catalog approval.

Four fixed roots must preexist, be absolute/canonical/disjoint, and have trusted ancestors (real paths, no symlinks). The publisher does not create roots. Store access is a bounded readonly layout adapter for Store-compatible jobs/blobs; service.Open and unbounded Store.Blob are deliberately NOT used. Limits are explicit positive with hard caps: job1MiB, config64KiB, VK16MiB, input64MiB, compressed artifact16MiB, compressed proof4096B, leaves16384, exportSTRICTLY BELOW16MiB, authority16KiB. Source response<=64MiB,input<=publisherinput,rows<=16384. Catalog manifest<=16MiB/artifact metadata<=8GiB; publisher reads only finalVK, neverCCS/PK.

A future config/directory deployment and execution authorization is separate from code implementation. No config activation or real job execution has occurred. The 85 frozen Go files,go.mod/go.sum,catalog receipts and historical source identities are not altered by this package/config.
