/**
 * Plan support as Microsoft publishes it, captured 7 August 2026.
 *
 * WHY THIS FILE EXISTS
 *
 * A release went out recommending sixteen operational tables be moved to the
 * Lake tier. Every one of those moves is impossible — Perf, InsightsMetrics,
 * ContainerLogV2, the Application Insights tables and the rest all publish
 * "Auxiliary / Lake table support: No". The guard that refuses impossible moves
 * was already in place and working; the data handed to it was assumed rather
 * than checked, so it refused nothing.
 *
 * Values are extracted verbatim from each table's generated reference page:
 * github.com/MicrosoftDocs/azure-monitor-docs -> articles/azure-monitor/reference/tables/<name>.md
 *
 * `tableCatalogue.test.ts` asserts every catalogued table agrees with this
 * snapshot, so a hand-edited `lakeCapable` that contradicts Microsoft fails the
 * build rather than shipping. Tables Microsoft does not document are absent
 * here and must be authored as not-capable, because unverified is not the same
 * as supported.
 *
 * To refresh: re-fetch the markdown and regenerate. Do not hand-edit.
 */

export interface PlanSupport {
  /** Supports the Basic table plan */
  basic: boolean
  /** Supports the Auxiliary / Lake table plan */
  lake: boolean
}

const SUPPORT: Record<string, readonly [boolean, boolean]> = {
  'aadmanagedidentitysigninlogs': [true, true],
  'aadnoninteractiveusersigninlogs': [true, true],
  'aadprovisioninglogs': [true, true],
  'aadriskyserviceprincipals': [true, true],
  'aadriskyusers': [true, true],
  'aadserviceprincipalriskevents': [true, true],
  'aadserviceprincipalsigninlogs': [true, true],
  'aaduserriskevents': [true, true],
  'abapauditlog': [true, true],
  'adfssigninlogs': [true, true],
  'agentsinfo': [true, true],
  'agwaccesslogs': [true, true],
  'agwfirewalllogs': [true, true],
  'alertevidence': [true, true],
  'alertinfo': [true, true],
  'anomalies': [true, true],
  'appavailabilityresults': [false, false],
  'appdependencies': [false, false],
  'appevents': [false, false],
  'appexceptions': [false, false],
  'appmetrics': [false, false],
  'apppageviews': [false, false],
  'appperformancecounters': [false, false],
  'apprequests': [false, false],
  'apptraces': [true, false],
  'asimauditeventlogs': [true, true],
  'asimauthenticationeventlogs': [true, true],
  'asimdhcpeventlogs': [true, true],
  'asimdnsactivitylogs': [true, true],
  'asimfileeventlogs': [true, true],
  'asimnetworksessionlogs': [true, true],
  'asimprocesseventlogs': [true, true],
  'asimregistryeventlogs': [true, true],
  'asimusermanagementactivitylogs': [true, true],
  'asimwebsessionlogs': [true, true],
  'auditlogs': [false, true],
  'awsalbaccesslogs': [true, true],
  'awscloudtrail': [true, true],
  'awscloudwatch': [true, true],
  'awsguardduty': [true, true],
  'awsnetworkfirewallflow': [true, true],
  'awsroute53resolver': [true, true],
  'awss3serveraccess': [true, true],
  'awssecurityhubfindings': [true, true],
  'awsvpcflow': [true, true],
  'awswaf': [true, true],
  'azfwapplicationrule': [true, true],
  'azfwdnsquery': [true, true],
  'azfwfatflow': [true, true],
  'azfwflowtrace': [true, true],
  'azfwidpssignature': [true, true],
  'azfwinternalfqdnresolutionfailure': [true, true],
  'azfwnatrule': [true, true],
  'azfwnetworkrule': [true, true],
  'azfwthreatintel': [true, true],
  'azkvauditlogs': [true, true],
  'azureactivity': [false, false],
  'azuremetrics': [true, false],
  'behaviorentities': [true, true],
  'behaviorinfo': [true, true],
  'campaigninfo': [true, true],
  'cloudappevents': [true, true],
  'cloudauditevents': [true, true],
  'clouddnsevents': [true, true],
  'cloudprocessevents': [true, true],
  'cloudstorageaggregatedevents': [true, true],
  'commonsecuritylog': [true, true],
  'containerlog': [false, false],
  'containerlogv2': [true, false],
  'copilotactivity': [true, true],
  'crowdstrikealerts': [true, true],
  'dataverseactivity': [true, true],
  'deviceevents': [true, true],
  'devicefilecertificateinfo': [true, true],
  'devicefileevents': [true, true],
  'deviceimageloadevents': [true, true],
  'deviceinfo': [true, true],
  'devicelogonevents': [true, true],
  'devicenetworkevents': [true, true],
  'devicenetworkinfo': [true, true],
  'deviceprocessevents': [true, true],
  'deviceregistryevents': [true, true],
  'devicetvmsecureconfigurationassessment': [true, true],
  'devicetvmsecureconfigurationassessmentkb': [true, true],
  'devicetvmsoftwareinventory': [true, true],
  'devicetvmsoftwarevulnerabilities': [true, true],
  'devicetvmsoftwarevulnerabilitieskb': [true, true],
  'disruptionandresponseevents': [true, true],
  'dnsevents': [false, true],
  'dnsinventory': [false, true],
  'dynamics365activity': [false, false],
  'emailattachmentinfo': [true, true],
  'emailevents': [true, true],
  'emailpostdeliveryevents': [true, true],
  'emailurlinfo': [true, true],
  'event': [false, false],
  'filemaliciouscontentinfo': [true, true],
  'gcpapigee': [true, true],
  'gcpauditlogs': [true, true],
  'gcpcdn': [true, true],
  'gcpcloudrun': [true, true],
  'gcpcloudsql': [true, true],
  'gcpcomputeengine': [true, true],
  'gcpdns': [true, true],
  'gcpiam': [true, true],
  'gcpids': [true, true],
  'gcpmonitoring': [true, true],
  'gcpnat': [true, true],
  'gcpnataudit': [true, true],
  'gcpresourcemanager': [true, true],
  'gcpvpcflow': [true, true],
  'gkeaudit': [true, true],
  'googlecloudscc': [true, true],
  'googleworkspacereports': [true, true],
  'heartbeat': [false, false],
  'identityaccountinfo': [true, true],
  'identitydirectoryevents': [true, true],
  'identityevents': [true, true],
  'identityinfo': [false, true],
  'identitylogonevents': [true, true],
  'identityqueryevents': [true, true],
  'insightsmetrics': [false, false],
  'intuneauditlogs': [false, true],
  'intunedevicecomplianceorg': [false, true],
  'intuneoperationallogs': [false, true],
  'laquerylogs': [true, true],
  'mcasshadowitreporting': [false, true],
  'messageevents': [true, true],
  'messagepostdeliveryevents': [true, true],
  'messageurlinfo': [true, true],
  'microsoftpurviewinformationprotection': [true, true],
  'networkaccesstraffic': [true, true],
  'oauthappinfo': [true, true],
  'officeactivity': [false, true],
  'operation': [false, false],
  'perf': [true, false],
  'powerautomateactivity': [true, true],
  'powerbiactivity': [true, true],
  'powerplatformadminactivity': [true, true],
  'projectactivity': [true, true],
  'purviewdatasensitivitylogs': [false, true],
  'qualysknowledgebase': [true, true],
  'rapid7insightvmcloudassets': [true, true],
  'rapid7insightvmcloudvulnerabilities': [true, true],
  'salesforceaudittrail': [true, true],
  'securityalert': [false, true],
  'securityevent': [true, true],
  'securityincident': [false, true],
  'securityrecommendation': [false, false],
  'sentinelaudit': [false, true],
  'sentinelhealth': [false, true],
  'signinlogs': [true, true],
  'storagebloblogs': [true, true],
  'storagefilelogs': [true, true],
  'storagequeuelogs': [true, true],
  'storagetablelogs': [true, true],
  'syslog': [false, true],
  'threatintelindicators': [true, false],
  'threatintelligenceindicator': [false, false],
  'threatintelobjects': [true, false],
  'urlclickevents': [true, true],
  'usage': [false, false],
  'w3ciislog': [false, false],
  'watchlist': [false, false],
  'windowsevent': [false, true],
}

/** Published plan support for a table. Null when Microsoft documents none. */
export function publishedPlanSupport(tableName: string): PlanSupport | null {
  const hit = SUPPORT[tableName.trim().toLowerCase()]
  return hit ? { basic: hit[0], lake: hit[1] } : null
}

export function verifiedTableCount(): number {
  return Object.keys(SUPPORT).length
}
