/**
 * Ingestion-time DCR workspace-transformation snippets.
 *
 * The catalogue tells people to "filter at ingestion" for half a dozen tables
 * and never says how. This is the how. Filtering beats every tier move on the
 * same table, because it removes the gigabytes rather than repricing them.
 *
 * Offered only where the table's published attributes say it supports DCR
 * transformations — `transformsForTable` takes that flag rather than looking it
 * up, so the caller cannot forget to check.
 *
 * ---------------------------------------------------------------------------
 * WHAT A TRANSFORMATION IS
 * ---------------------------------------------------------------------------
 * A Data Collection Rule (DCR) transformation runs a KQL statement against each
 * incoming record before it is written to the workspace. Rows the statement
 * discards are never stored and never billed for ingestion. The input is the
 * virtual table `source`; the statement is stored in the `transformKql` property
 * of a data flow (or, for connectors that do not use a DCR of their own, in the
 * single *workspace transformation DCR*, one per workspace, kind
 * `WorkspaceTransforms`).
 *
 * ---------------------------------------------------------------------------
 * CONSTRAINTS ESTABLISHED FROM MICROSOFT DOCUMENTATION (verified 2026-08)
 * ---------------------------------------------------------------------------
 *
 * 1. PER-ROW ONLY. The transformation is applied to each record individually,
 *    so no operator that spans multiple rows is available. `summarize`, `join`,
 *    `union`, `lookup`, `sort`/`order`, `top`, `take`/`limit`, `distinct`,
 *    `mv-expand`, `make-series` and `externaldata` are all unavailable. Only
 *    operators on the published allow-list work.
 *
 * 2. THE COMPLETE TABULAR OPERATOR ALLOW-LIST IS:
 *      extend, project, print, where, parse, project-away, project-rename,
 *      datatable, columnifexists
 *    The only permitted data sources for the statement are `source` and `print`.
 *    `let` is supported (scalar, tabular, or user-defined function with scalar
 *    arguments only).
 *
 * 3. SCALAR SUBSET IS ALSO RESTRICTED. All numeric and datetime/timespan
 *    arithmetic is allowed. String operators are limited to == != =~ !~
 *    contains / !contains / contains_cs / !contains_cs, has / !has / has_cs /
 *    !has_cs, startswith / endswith (and their negated and _cs variants),
 *    `matches regex`, `in` and `!in`. Note there is no `in~` / `!in~`, so
 *    case-insensitive set membership must be written as
 *    `tolower(Col) !in (...)`. Useful permitted functions include tolower,
 *    toupper, extract, extract_all, split, substring, strcat, strlen, isempty,
 *    isnotempty, isnull, isnotnull, replace, iif, case, min_of, max_of,
 *    parse_json, hash_sha256, and the conversion family (toint, tostring, …).
 *    Notably ABSENT: coalesce, not(), trim(), array_sort, todynamic, bag_keys.
 *    Two functions exist *only* inside transformations: `parse_cef_dictionary`
 *    (parses a CEF Extension string into a dynamic bag) and `geo_location`
 *    (IP → country/region/city; calls an external service and adds latency —
 *    use at most a few times per transformation).
 *
 * 4. TimeGenerated IS MANDATORY. The output must contain a valid `TimeGenerated`
 *    column of type datetime. If the source does not supply one, add it with
 *    `extend TimeGenerated = now()`. Never `project-away TimeGenerated`, and
 *    never write a `project` list that omits it. Every snippet below preserves
 *    it by using `where` / `project-away` rather than a whitelisting `project`.
 *
 * 5. COLUMN RULES. Omitting a column is allowed and saves money — the column is
 *    simply empty for those records. Emitting a column that does NOT exist in
 *    the destination table is accepted without error but is still billed as
 *    ingested data even though it is silently discarded. Any helper column
 *    created with `extend` must therefore be removed again with `project-away`.
 *    Standard tables have fixed schemas and drop unknown columns silently, so a
 *    stray helper column fails quietly and expensively rather than loudly.
 *
 * 6. COST GOTCHA — AND THE SENTINEL EXEMPTION. In plain Azure Monitor, a
 *    transformation that filters out MORE than 50% of incoming Analytics or
 *    Basic data incurs a data-processing charge on the excess, computed as
 *    `[GB dropped] - ([GB incoming] / 2)`. For Auxiliary/Data lake destinations
 *    the processing charge applies to 100% of incoming volume regardless.
 *    HOWEVER: Microsoft states explicitly that a Log Analytics workspace enabled
 *    for Microsoft Sentinel is NOT subject to the filtering ingestion charge on
 *    Analytics tables, no matter how much the transformation filters. For this
 *    calculator's audience that means an aggressive Analytics-table filter is
 *    genuinely free of processing cost — but the exemption must not be assumed
 *    for Auxiliary/Data lake tables.
 *
 * 7. OTHER GOTCHAS WORTH SURFACING IN THE UI:
 *    - Single line. `transformKql` must contain no newline characters when the
 *      JSON is edited directly (the portal editor inserts `\n` for you).
 *    - Latency budget. A transformation should run in under 1 second; data loss
 *      can occur if it exceeds 20 seconds. `parse` is capped at 10 columns per
 *      statement.
 *    - `parse kind=regex` behaves differently here than in Log Analytics: the
 *      pattern must match the ENTIRE input string or no fields are populated.
 *      A pattern proven in a Sentinel query can silently populate nothing.
 *    - Propagation. A new or changed transformation can take up to 60 minutes
 *      to take effect.
 *    - Placement matters. AMA-based connectors (Windows Security Events, CEF,
 *      Syslog, Windows Forwarded Events) carry their own DCR — put the
 *      transformation there. Service-to-service and diagnostic-settings
 *      connectors have no DCR of their own, so they use the workspace
 *      transformation DCR. A workspace transformation is IGNORED for any data
 *      that already arrived through another DCR, which is the usual reason a
 *      "working" transformation appears to do nothing.
 *    - Workspace transformations apply to ALL data reaching that table from
 *      every source; use a `where` on Computer / DeviceVendor / _ResourceId if
 *      only some sources should be filtered.
 *    - Sentinel's portal-based Filter rules and a hand-written DCR transform can
 *      compound. Two filters that each keep a different subset can combine to
 *      ingest nothing.
 *
 * 8. UNDER-CLAIMING. Microsoft publishes no reduction percentages for any of
 *    these filters, and the real figure depends entirely on the estate. No
 *    `reductionNote` below states a percentage. Every snippet should be run as a
 *    read-only query against the live table first (swap `source` for the table
 *    name) to measure the actual effect before it is deployed.
 *
 * ---------------------------------------------------------------------------
 * SOURCES
 * ---------------------------------------------------------------------------
 * https://learn.microsoft.com/en-us/azure/azure-monitor/essentials/data-collection-transformations
 * https://learn.microsoft.com/en-us/azure/azure-monitor/essentials/data-collection-transformations-structure
 * https://learn.microsoft.com/en-us/azure/azure-monitor/essentials/data-collection-transformations-samples
 * https://learn.microsoft.com/en-us/azure/azure-monitor/essentials/data-collection-transformations-create
 * https://learn.microsoft.com/en-us/azure/sentinel/data-transformation
 * https://learn.microsoft.com/en-us/azure/sentinel/transformation-filter-split
 * Column names taken from the per-table reference pages under
 * https://learn.microsoft.com/en-us/azure/azure-monitor/reference/tables/
 */

export interface DcrTransform {
  /** Destination table the transformation is attached to. */
  table: string
  /**
   * Set only where a table has more than one transform, to tell them apart.
   * CommonSecurityLog has two: filtering rows, and trimming the
   * AdditionalExtensions column.
   */
  title?: string
  /**
   * Single-line-safe KQL, starting with `source`. Valid within the documented
   * transformation subset. Every column referenced is verified against the
   * table's reference page.
   */
  transformKql: string
  /** Honest, qualitative statement of what the filter removes. No percentages. */
  reductionNote: string
  /** What the customer gives up: the detections and investigations that need the dropped rows. */
  risk: string
}

export const DCR_TRANSFORMS: DcrTransform[] = [
  {
    table: 'W3CIISLog',
    transformKql:
      // tolower() is applied to the INPUT, not the result. extract() is
      // case-sensitive (RE2), so lowering afterwards is too late: /assets/Logo.PNG
      // would return "" from the match, miss the list, and be kept. IIS URLs are
      // routinely mixed-case, so that failed quietly and filtered less than the
      // note below claims.
      'source | extend Ext = extract(@"\\.([a-z0-9]{1,5})$", 1, tolower(csUriStem)) | where Ext !in ("js", "css", "png", "jpg", "jpeg", "gif", "ico", "svg", "woff", "woff2", "ttf", "map") | where csUserAgent !has "HealthCheck" and csUserAgent !has "AlwaysOn" and csUserAgent !has "kube-probe" | project-away Ext',
    reductionNote:
      'Drops requests whose csUriStem ends in a static-asset extension, plus requests from load-balancer and platform health probes identified by csUserAgent. On a browser-facing site each page view produces one dynamic request and many asset requests, so this is normally the largest single reduction available on this table — but the ratio is entirely site-specific. Measure it first with: W3CIISLog | summarize count() by tostring(extract(@"\\.([a-z0-9]{1,5})$", 1, tolower(csUriStem))). The helper column Ext is removed again because a column absent from the destination table is billed but not stored.',
    risk:
      'Web-shell and defacement hunting suffers most: attackers routinely drop payloads with innocuous-looking extensions, and .svg is a live XSS and SSRF vector. Enumeration and forced-browsing detections that count 404s lose the asset-path 404s. Hotlinking, scraping and credential-stuffing analytics that rely on asset request patterns break, as does any use of csBytes/scBytes for exfiltration volume. Health-probe filtering by user agent is a naming convention, not a guarantee: an attacker who sets csUserAgent to "AlwaysOn" is now invisible on this table, so pair the probe filter with a cIP restriction to the known probe ranges where you can. Because the extension test only inspects csUriStem, a request to /app.js?cmd=whoami is still dropped even though csUriQuery carries the payload.',
  },
  {
    table: 'Event',
    transformKql:
      'source | where EventLevel <= 3 or EventID in (104, 1074, 6005, 6006, 6008, 7040, 7045)',
    reductionNote:
      'Drops Information (EventLevel 4) and Verbose (EventLevel 5) records from the Windows System and Application logs, keeping Critical, Error and Warning, and then adds back a short allow-list of Information-level EventIDs that carry real security value: 104 (event log cleared), 1074 (shutdown/restart initiated), 6005/6006/6008 (event log service started, stopped, previous shutdown unexpected), 7040 (service start type changed) and 7045 (new service installed). The allow-list is the important half — a pure level filter alone would discard 7045, which is a primary persistence indicator. Note this is the Event table only; Security-log auditing lands in SecurityEvent and is untouched. Extend the allow-list before deploying: run Event | summarize sum(_BilledSize) by EventID, EventLevel, Source to see what your own estate actually pays for.',
    risk:
      'Most Windows persistence, defence-evasion and application-layer telemetry is logged at Information level and is discarded by everything outside the allow-list. Concretely you lose: scheduled task creation and modification (Task Scheduler operational events), Windows Defender detection and configuration-change events (Microsoft-Windows-Windows Defender 1116/1117/5001/5007), PowerShell module and script-block logging, WMI activity, printer and driver installs, MSI installs, and remote desktop session events. Any analytics rule, hunting query, workbook or ASIM parser keyed on an Information-level EventID silently returns nothing — with no error, so nobody notices until an investigation needs the data. Baselining and anomaly detections that model normal event rates are also skewed, because the removed volume was the bulk of the baseline. If the estate is subject to an audit regime that requires complete System/Application log retention, this filter breaks it. Safer variant: keep the level filter but grow the allow-list from your own top-EventID query rather than from this default.',
  },
  {
    table: 'Perf',
    transformKql:
      'source | where ObjectName != "Process" | where CounterName in ("% Processor Time", "% Committed Bytes In Use", "Available MBytes", "% Free Space", "Free Megabytes", "Bytes Total/sec", "Disk Transfers/sec") | project-away CounterPath',
    reductionNote:
      'Two independent reductions. First, dropping ObjectName == "Process" removes the highest-cardinality source on this table: one sample per counter per process per interval, which scales with process count rather than with server count. Second, the CounterName allow-list keeps a conventional CPU / memory / disk / network health set and discards everything else. Finally CounterPath is removed — it is a long string that concatenates Computer, ObjectName, InstanceName and CounterName, all of which remain as their own columns, so it is redundant bytes on every row. Perf is very rarely a Sentinel detection source; it is usually collected out of habit from an Azure Monitor DCR that also feeds the Sentinel workspace. Confirm the counter names on your own machines first, since they differ between Windows and Linux (Linux uses "% Used Space" and "Free Megabytes" under different objects) and a name that does not match drops the counter entirely.',
    risk:
      'Per-process counters are the loss that matters: cryptomining, ransomware encryption bursts and resource-exhaustion denial of service are all detected by per-process CPU, memory or IO anomalies, and none of that is visible from _Total. Capacity planning, right-sizing and chargeback reporting built on the Process object stop working. Any Azure Monitor alert rule, VM Insights view, autoscale signal or workbook bound to a counter outside the allow-list breaks silently — this table is usually shared between the security team and the platform team, so check with the platform owner before applying. Removing CounterPath breaks any saved query that filters or joins on it, even though the same information is reconstructible from the surviving columns.',
  },
  {
    table: 'CommonSecurityLog',
    title: 'Drop permitted-traffic rows',
    transformKql:
      'source | extend Act = tolower(DeviceAction) | where Act !in ("permit", "permitted", "allow", "allowed", "accept", "built", "teardown") | project-away Act',
    reductionNote:
      'Drops allowed, permitted, built and torn-down firewall sessions while keeping denies, drops, resets, alerts, IPS/IDS signature hits and every record whose DeviceAction does not match the list. On a perimeter firewall the accept/teardown pair dominates the record count, but nothing in Microsoft documentation quantifies this and it varies enormously by device role — a segmentation firewall inside the estate looks nothing like an internet edge device. DeviceAction values are vendor-specific strings, not a normalised enumeration, so this list is a starting point and must be verified before deployment with: CommonSecurityLog | summarize count() by DeviceVendor, DeviceProduct, DeviceAction. tolower() is used because the transformation subset provides `in` and `!in` but no case-insensitive `in~`. The filter deliberately fails open: a record with an empty or unrecognised DeviceAction is kept, which is the correct default when a new appliance appears.',
    risk:
      'Successful traffic is the traffic that mattered. Dropping allows removes the evidence for command-and-control beaconing (regular allowed outbound sessions to a low-reputation host), data exfiltration sizing (SentBytes and ReceivedBytes only exist on sessions that completed), lateral movement over permitted ports, and any "first time this host talked to that country" or rare-destination analytic. It also breaks TI matching against allowed egress — the case where an indicator fires on a connection that was NOT blocked is the highest-value TI hit there is, and this filter deletes it. Post-breach investigation loses the ability to reconstruct what an attacker reached after the initial denies stopped. Several built-in Sentinel analytics rules and hunting queries for CEF sources assume both accepts and denies are present. Vendors that report the verdict in Activity, DeviceEventClassID or Reason rather than DeviceAction are unaffected by this filter, so it can look like it is working while the noisiest device is untouched. Strongly consider a split rule to the data lake instead of an outright filter, so allowed traffic remains queryable for investigation at a lower rate.',
  },
  {
    table: 'Syslog',
    transformKql:
      'source | where Facility in ("auth", "authpriv") or SeverityLevel !in ("debug", "info", "notice")',
    reductionNote:
      'Keeps every auth and authpriv record at any severity — that is where sshd, sudo, su, PAM and account-change events live, and most of them are logged at info, so a blanket severity filter would delete exactly the records worth having. For all other facilities it keeps warning and above, discarding debug, info and notice. Facility and SeverityLevel are both lowercase strings in this table. The best reduction on Syslog is usually upstream of the transformation: narrow facilityNames and logLevels in the AMA data source itself so the volume never crosses the network, and use this transform for what the collector settings cannot express.',
    risk:
      'Application and daemon telemetry at info level disappears: web server access logs shipped over syslog, cron execution, systemd unit start/stop, package installation via the daemon facility, and container runtime events. Detections for persistence via cron or systemd, and for suspicious package installation, break. The local0-local7 facilities are where network appliances, proxies and many security products land, and they commonly log at info — check what is arriving on those facilities before applying, because this filter takes the lot. Kernel-facility info messages covering module loads and iptables logging are also removed. As with CommonSecurityLog, an analytics rule that finds nothing is indistinguishable from an analytics rule that is working, so inventory the rules bound to Syslog before deploying.',
  },
  {
    table: 'ThreatIntelIndicators',
    transformKql: 'source | project-away Data',
    reductionNote:
      'The Data column is a dynamic holding the complete STIX 2.1 object for the indicator — every property, formatted per the STIX specification. It is by a wide margin the largest column on the row, and much of it duplicates data already promoted into its own typed column: Pattern, ObservableKey, ObservableValue, Confidence, Created, Modified, ValidFrom, ValidUntil, Revoked, IsActive and Tags all remain populated after Data is removed. The reference page confirms ThreatIntelIndicators has DCR workspace transformation support. Because the TI connectors are service-to-service and have no DCR of their own, this belongs in the workspace transformation DCR. No percentage is claimed: the saving depends on how verbose your feeds are, and a feed that ships bare IP indicators has a far smaller Data blob than one shipping full STIX reports.',
    risk:
      'This one is genuinely functional, not just analytical, and should be tested in a non-production workspace before it goes anywhere near a live one. Sentinel and Defender render indicator detail in the Threat Intelligence blade from the STIX object, and the properties that exist ONLY in Data — kill_chain_phases, description, labels, external_references, object relationships, and any feed-specific extension properties — become unrecoverable. Every hunting query, workbook and playbook that does parse_json(Data) or reaches into Data.<property> returns null with no error. Anything that resolves indicator relationships (indicator to attack-pattern, indicator to threat-actor) breaks, because relationships are not promoted to a column. Microsoft does not publish which internal Sentinel components read this column, so the honest position is that the blast radius is not fully documented — the trimming works and the ingestion saving is real, but validate the TI blade and your TI-dependent rules after applying, and be prepared to revert. Note also that removing Data is irreversible for records already filtered; re-enabling the connector will not backfill it.',
  },
  {
    // Keyed on the real destination table so the lookup can find it.
    // AdditionalExtensions is a string COLUMN on CommonSecurityLog — Microsoft's
    // billing page calls it "the AdditionalExtensions table", but the table
    // reference has no page for it and the column is documented on
    // CommonSecurityLog. Where the two disagree, the schema wins.
    table: 'CommonSecurityLog',
    title: 'Trim the AdditionalExtensions column',
    transformKql: 'source | project-away AdditionalExtensions',
    reductionNote:
      'IMPORTANT: AdditionalExtensions is not a table. There is no AdditionalExtensions table in the Azure Monitor Logs reference — it is a string column on CommonSecurityLog (the Sentinel connector reports the same trimming opportunity under that name, which is where the confusion comes from). It holds every CEF extension key/value pair that has no dedicated column, concatenated into one string, and on chatty appliances it is often the widest column on the row. Microsoft has already promoted EventOutcome, Reason and DeviceEventCategory out of it into their own columns, so on modern connectors part of its content is duplicated. Before dropping it wholesale, extract what you need: `source | extend Sig = extract(@"cs6=([^;]*)", 1, AdditionalExtensions) | project-away AdditionalExtensions` keeps one field and discards the rest, and `parse_cef_dictionary` (available only inside transformations) parses the whole extension string if you need several. Any extracted value must land in a column that exists on CommonSecurityLog — the DeviceCustomString1..6 and FlexString1..2 columns are the intended homes — or it is billed and then silently discarded.',
    risk:
      'The contents are entirely vendor-defined, so what you lose is unknowable from the schema alone and must be established by sampling: CommonSecurityLog | where isnotempty(AdditionalExtensions) | summarize count() by DeviceVendor, DeviceProduct | take 20, then reading actual values per product. Fields commonly found only here include proxy URL categories, TLS/JA3 fingerprints, email sender and subject on mail-security appliances, file hashes and sandbox verdicts on sandboxing products, user-agent strings, and the vendor rule or policy name that fired. Losing hashes and URLs removes IOC-pivot capability during an investigation and can break TI matching for products that report indicators only in this field. Several Sentinel solution parsers and ASIM CEF parsers read AdditionalExtensions to populate normalised fields, so ASIM-based detections can degrade even where the raw table looks healthy. Prefer the extract-then-drop pattern over an outright project-away wherever the appliance is a mail, proxy or sandbox product.',
  },
]

const BY_TABLE = new Map<string, DcrTransform[]>()
for (const t of DCR_TRANSFORMS) {
  const key = t.table.toLowerCase()
  BY_TABLE.set(key, [...(BY_TABLE.get(key) ?? []), t])
}

/**
 * Ingestion-time filters available for a table.
 *
 * Gated on the table's published DCR transformation support, for the same
 * reason tier moves are gated on plan support: a transform offered for a table
 * that cannot carry one is advice the customer cannot follow. Seven of the
 * tables in the verified snapshot publish "DCR workspace transformation
 * support: No".
 *
 * Returns an empty array when the table has no transform, is not documented, or
 * does not support transformations.
 */
export function transformsForTable(
  tableName: string,
  supportsDcr: boolean | null,
): DcrTransform[] {
  if (supportsDcr !== true) return []
  return BY_TABLE.get(tableName.trim().toLowerCase()) ?? []
}

export function transformTableCount(): number {
  return BY_TABLE.size
}
