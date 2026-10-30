//! Finds IP cameras on the local network, so users pick a camera and enter its login instead of composing an
//! `rtsp://user:password@host/path` URL by hand.
//!
//! Two ways, merged by address:
//! - ONVIF WS-Discovery: a multicast probe that ONVIF cameras (Reolink, Hikvision, Dahua, Amcrest, Axis, ...)
//!   answer with their name, model and ONVIF service address. With the login, `onvif_streams` then asks the camera
//!   for its stream URLs, so no vendor-specific path is needed.
//! - A scan of the local /24 network for the RTSP port, for cameras without ONVIF (or with it switched off). The
//!   app then offers vendor path presets.

use std::collections::BTreeMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket};
use std::time::Duration;

use base64::Engine;
use serde::Serialize;
use sha1::{Digest, Sha1};
use tokio::net::TcpStream;

const WS_DISCOVERY: &str = "239.255.255.250:3702";
const PROBE_WAIT: Duration = Duration::from_millis(2500);
const RTSP_PORT: u16 = 554;
const CONNECT_TIMEOUT: Duration = Duration::from_millis(600);
const ONVIF_TIMEOUT: Duration = Duration::from_secs(5);

/// A camera found on the network.
#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FoundCamera {
    pub host: String,
    /// From the ONVIF scopes, e.g. "Reolink" or "E1 Zoom".
    pub name: Option<String>,
    pub hardware: Option<String>,
    /// ONVIF device service URL, if the camera answered the ONVIF probe.
    pub onvif_url: Option<String>,
    /// Whether the RTSP port (554) accepts connections.
    pub rtsp: bool,
}

/// A stream the camera offers, with its RTSP URL including the login.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CameraStream {
    pub name: String,
    pub url: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

pub async fn discover() -> Vec<FoundCamera> {
    let (onvif, scanned) = tokio::join!(tokio::task::spawn_blocking(probe_onvif), scan_rtsp(),);
    let mut cameras: BTreeMap<Ipv4Addr, FoundCamera> = BTreeMap::new();
    for camera in onvif.unwrap_or_default() {
        if let Ok(ip) = camera.host.parse() {
            cameras.insert(ip, camera);
        }
    }
    for ip in scanned {
        let camera = cameras.entry(ip).or_insert_with(|| FoundCamera {
            host: ip.to_string(),
            ..Default::default()
        });
        camera.rtsp = true;
    }
    // Cameras that ignore the multicast probe (or a network that drops it) may still serve ONVIF on a usual port.
    let missing: Vec<Ipv4Addr> = cameras
        .iter()
        .filter(|(_, c)| c.onvif_url.is_none())
        .map(|(ip, _)| *ip)
        .collect();
    let probed = futures_util::future::join_all(missing.into_iter().map(|ip| async move {
        let (onvif, reolink) = tokio::join!(find_onvif(ip), port_open(ip, REOLINK_PORT));
        (ip, onvif, reolink)
    }))
    .await;
    for (ip, onvif, reolink) in probed {
        if let Some(camera) = cameras.get_mut(&ip) {
            camera.onvif_url = onvif;
            // Reolink's own protocol port; lets the app suggest Reolink's stream paths.
            if reolink && camera.name.is_none() {
                camera.name = Some("Reolink".into());
            }
        }
    }
    cameras.into_values().collect()
}

/// Ports ONVIF device services commonly listen on: Reolink 8000, most others 80, Tapo 2020.
const ONVIF_PORTS: [u16; 4] = [8000, 80, 2020, 8080];
const REOLINK_PORT: u16 = 9000;

async fn port_open(ip: Ipv4Addr, port: u16) -> bool {
    tokio::time::timeout(CONNECT_TIMEOUT, TcpStream::connect((ip, port)))
        .await
        .is_ok_and(|r| r.is_ok())
}

/// The ONVIF device service URL of `ip`, if one of the usual ports answers GetSystemDateAndTime, which ONVIF
/// devices must answer without a login.
async fn find_onvif(ip: Ipv4Addr) -> Option<String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .ok()?;
    for port in ONVIF_PORTS {
        if !port_open(ip, port).await {
            continue;
        }
        let url = format!("http://{ip}:{port}/onvif/device_service");
        let envelope = r#"<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><GetSystemDateAndTime xmlns="http://www.onvif.org/ver10/device/wsdl"/></s:Body></s:Envelope>"#;
        let Ok(response) = client
            .post(&url)
            .header("Content-Type", "application/soap+xml; charset=utf-8")
            .body(envelope)
            .send()
            .await
        else {
            continue;
        };
        if response
            .text()
            .await
            .is_ok_and(|text| text.contains("GetSystemDateAndTimeResponse"))
        {
            return Some(url);
        }
    }
    None
}

// ---------------------------------------------------------------------------------------------------------------
// WS-Discovery

fn probe_message(id: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
<e:Header><w:MessageID>uuid:{id}</w:MessageID><w:To e:mustUnderstand="true">urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To><w:Action e:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action></e:Header>
<e:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></e:Body>
</e:Envelope>"#
    )
}

fn probe_onvif() -> Vec<FoundCamera> {
    let Ok(socket) = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)) else {
        return vec![];
    };
    let _ = socket.set_multicast_ttl_v4(2);
    let _ = socket.set_read_timeout(Some(Duration::from_millis(200)));
    let message = probe_message(&random_hex(16));
    // UDP may drop a packet; cameras ignore duplicate probes with the same id.
    for _ in 0..2 {
        let _ = socket.send_to(message.as_bytes(), WS_DISCOVERY);
    }
    let deadline = std::time::Instant::now() + PROBE_WAIT;
    let mut found: BTreeMap<String, FoundCamera> = BTreeMap::new();
    let mut buf = vec![0u8; 65536];
    while std::time::Instant::now() < deadline {
        let Ok((len, from)) = socket.recv_from(&mut buf) else {
            continue;
        };
        let xml = String::from_utf8_lossy(&buf[..len]);
        if let Some(camera) = parse_probe_match(&xml, from) {
            found.insert(camera.host.clone(), camera);
        }
    }
    found.into_values().collect()
}

/// Reads a ProbeMatch: the camera's address, its ONVIF service URL and name/model from the scopes.
fn parse_probe_match(xml: &str, from: SocketAddr) -> Option<FoundCamera> {
    let xaddrs = element_text(xml, "XAddrs")?;
    let host = from.ip().to_string();
    // A camera may list several addresses (e.g. IPv6 too); prefer the one it answered from.
    let onvif_url = xaddrs
        .split_whitespace()
        .find(|url| url.contains(&host))
        .or_else(|| xaddrs.split_whitespace().next())?
        .to_string();
    let scopes = element_text(xml, "Scopes").unwrap_or_default();
    let scope = |key: &str| {
        scopes
            .split_whitespace()
            .find_map(|s| s.strip_prefix(&format!("onvif://www.onvif.org/{key}/")))
            .map(|v| percent_decode(v).replace('_', " "))
            .filter(|v| !v.is_empty())
    };
    Some(FoundCamera {
        host,
        name: scope("name"),
        hardware: scope("hardware"),
        onvif_url: Some(onvif_url),
        rtsp: false,
    })
}

// ---------------------------------------------------------------------------------------------------------------
// RTSP port scan

/// The IPv4 address this computer uses on the local network: the source address of a route to a public address.
/// Nothing is sent, connecting a UDP socket only picks the route.
fn local_ipv4() -> Option<Ipv4Addr> {
    let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    socket.connect(("192.0.2.1", 9)).ok()?;
    match socket.local_addr().ok()?.ip() {
        IpAddr::V4(ip) if ip.is_private() => Some(ip),
        _ => None,
    }
}

async fn scan_rtsp() -> Vec<Ipv4Addr> {
    let Some(own) = local_ipv4() else {
        return vec![];
    };
    let [a, b, c, _] = own.octets();
    let probes = (1..=254u8)
        .map(|d| Ipv4Addr::new(a, b, c, d))
        .filter(|ip| *ip != own)
        .map(|ip| async move { port_open(ip, RTSP_PORT).await.then_some(ip) });
    futures_util::future::join_all(probes)
        .await
        .into_iter()
        .flatten()
        .collect()
}

// ---------------------------------------------------------------------------------------------------------------
// ONVIF stream URLs

/// Asks an ONVIF camera for its streams, with the login. Returns RTSP URLs that include the login.
pub async fn onvif_streams(
    onvif_url: &str,
    user: &str,
    password: &str,
) -> Result<Vec<CameraStream>, String> {
    let url = url::Url::parse(onvif_url).map_err(|_| "invalid ONVIF address".to_string())?;
    if !matches!(url.scheme(), "http" | "https") || !is_local_host(&url) {
        return Err("the ONVIF address must be on the local network".into());
    }
    let client = reqwest::Client::builder()
        .timeout(ONVIF_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;

    let caps = soap(
        &client,
        onvif_url,
        user,
        password,
        r#"<GetCapabilities xmlns="http://www.onvif.org/ver10/device/wsdl"><Category>Media</Category></GetCapabilities>"#,
    )
    .await?;
    let media_url = element_text(&section(&caps, "Media").unwrap_or(&caps), "XAddr")
        .map(|s| s.trim().to_string())
        .ok_or("the camera did not name its media service")?;
    let media_url = same_host(&media_url, &url);

    let profiles = soap(
        &client,
        &media_url,
        user,
        password,
        r#"<GetProfiles xmlns="http://www.onvif.org/ver10/media/wsdl"/>"#,
    )
    .await?;
    let mut streams = vec![];
    for profile in parse_profiles(&profiles) {
        let body = format!(
            r#"<GetStreamUri xmlns="http://www.onvif.org/ver10/media/wsdl"><StreamSetup><Stream xmlns="http://www.onvif.org/ver10/schema">RTP-Unicast</Stream><Transport xmlns="http://www.onvif.org/ver10/schema"><Protocol>RTSP</Protocol></Transport></StreamSetup><ProfileToken>{}</ProfileToken></GetStreamUri>"#,
            xml_escape(&profile.token)
        );
        let Ok(response) = soap(&client, &media_url, user, password, &body).await else {
            continue;
        };
        let Some(uri) = element_text(&response, "Uri") else {
            continue;
        };
        let uri = same_host(&xml_unescape(uri.trim()), &url);
        streams.push(CameraStream {
            name: profile.name,
            url: with_login(&uri, user, password),
            width: profile.width,
            height: profile.height,
        });
    }
    if streams.is_empty() {
        return Err("the camera offered no RTSP streams".into());
    }
    // Largest first: the main stream suits calibration best.
    streams.sort_by_key(|s| std::cmp::Reverse(s.width.unwrap_or(0) * s.height.unwrap_or(0)));
    Ok(streams)
}

async fn soap(
    client: &reqwest::Client,
    url: &str,
    user: &str,
    password: &str,
    body: &str,
) -> Result<String, String> {
    let envelope = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Header>{}</s:Header><s:Body>{body}</s:Body></s:Envelope>"#,
        security_header(user, password, &random_bytes(16), &now_utc())
    );
    let response = client
        .post(url)
        .header("Content-Type", "application/soap+xml; charset=utf-8")
        .body(envelope)
        .send()
        .await
        .map_err(|e| format!("could not reach the camera: {e}"))?;
    let status = response.status();
    let text = response.text().await.map_err(|e| e.to_string())?;
    if status.is_success() {
        return Ok(text);
    }
    if status.as_u16() == 401
        || text.contains("NotAuthorized")
        || text.contains("FailedAuthentication")
    {
        return Err("the camera rejected the username or password".into());
    }
    Err(format!("the camera answered {status}"))
}

/// WS-Security UsernameToken with a password digest: Base64(SHA1(nonce + created + password)).
fn security_header(user: &str, password: &str, nonce: &[u8], created: &str) -> String {
    let mut hasher = Sha1::new();
    hasher.update(nonce);
    hasher.update(created.as_bytes());
    hasher.update(password.as_bytes());
    let b64 = base64::engine::general_purpose::STANDARD;
    format!(
        r#"<Security xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" s:mustUnderstand="1"><UsernameToken><Username>{}</Username><Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">{}</Password><Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">{}</Nonce><Created xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">{created}</Created></UsernameToken></Security>"#,
        xml_escape(user),
        b64.encode(hasher.finalize()),
        b64.encode(nonce),
    )
}

struct Profile {
    token: String,
    name: String,
    width: Option<u32>,
    height: Option<u32>,
}

fn parse_profiles(xml: &str) -> Vec<Profile> {
    let mut profiles = vec![];
    let mut rest = xml;
    while let Some(start) = find_tag(rest, "Profiles") {
        let tag_end = rest[start..]
            .find('>')
            .map(|i| start + i + 1)
            .unwrap_or(rest.len());
        let tag = &rest[start..tag_end];
        let end = find_close(&rest[tag_end..], "Profiles")
            .map(|i| tag_end + i)
            .unwrap_or(rest.len());
        let inner = &rest[tag_end..end];
        if let Some(token) = attribute(tag, "token") {
            let encoder = section(inner, "VideoEncoderConfiguration").unwrap_or(inner);
            profiles.push(Profile {
                name: element_text(inner, "Name")
                    .map(|s| s.trim().to_string())
                    .unwrap_or_else(|| token.clone()),
                token,
                width: element_text(encoder, "Width").and_then(|s| s.trim().parse().ok()),
                height: element_text(encoder, "Height").and_then(|s| s.trim().parse().ok()),
            });
        }
        rest = &rest[end..];
    }
    profiles
}

// ---------------------------------------------------------------------------------------------------------------
// Helpers

/// Inserts the login into an RTSP URL, percent-encoded, replacing any login it has.
pub fn with_login(uri: &str, user: &str, password: &str) -> String {
    let Ok(mut url) = url::Url::parse(uri) else {
        return uri.to_string();
    };
    if user.is_empty() {
        return uri.to_string();
    }
    let _ = url.set_username(user);
    let _ = url.set_password(Some(password).filter(|p| !p.is_empty()));
    url.to_string()
}

/// Cameras behind NAT or with a misconfigured address report URLs with another host; use the one we reached.
fn same_host(reported: &str, reached: &url::Url) -> String {
    match (url::Url::parse(reported), reached.host_str()) {
        (Ok(mut url), Some(host)) => {
            let _ = url.set_host(Some(host));
            url.to_string()
        }
        _ => reported.to_string(),
    }
}

fn is_local_host(url: &url::Url) -> bool {
    match url.host() {
        Some(url::Host::Ipv4(ip)) => ip.is_private() || ip.is_link_local() || ip.is_loopback(),
        Some(url::Host::Ipv6(ip)) => {
            ip.is_loopback()
                || (ip.segments()[0] & 0xfe00) == 0xfc00
                || (ip.segments()[0] & 0xffc0) == 0xfe80
        }
        Some(url::Host::Domain(name)) => name.ends_with(".local") || !name.contains('.'),
        None => false,
    }
}

/// Start of `<prefix:name` or `<name` followed by `>`, `/` or whitespace.
fn find_tag(xml: &str, name: &str) -> Option<usize> {
    let mut from = 0;
    while let Some(i) = xml[from..].find('<') {
        let start = from + i;
        let rest = &xml[start + 1..];
        let local = rest
            .split(|c: char| c.is_whitespace() || c == '>' || c == '/')
            .next()
            .unwrap_or("");
        let local = local.rsplit(':').next().unwrap_or("");
        if local == name && !rest.starts_with('/') {
            return Some(start);
        }
        from = start + 1;
    }
    None
}

fn find_close(xml: &str, name: &str) -> Option<usize> {
    let mut from = 0;
    while let Some(i) = xml[from..].find("</") {
        let start = from + i;
        let rest = &xml[start + 2..];
        let local = rest.split('>').next().unwrap_or("").trim();
        if local.rsplit(':').next() == Some(name) {
            return Some(start);
        }
        from = start + 2;
    }
    None
}

/// The text inside the first element with this local name.
fn element_text<'a>(xml: &'a str, name: &str) -> Option<&'a str> {
    let inner = section(xml, name)?;
    (!inner.contains('<')).then_some(inner)
}

/// The content of the first element with this local name.
fn section<'a>(xml: &'a str, name: &str) -> Option<&'a str> {
    let start = find_tag(xml, name)?;
    let open_end = start + xml[start..].find('>')? + 1;
    if xml[..open_end].ends_with("/>") {
        return Some("");
    }
    let close = find_close(&xml[open_end..], name)?;
    Some(&xml[open_end..open_end + close])
}

fn attribute(tag: &str, name: &str) -> Option<String> {
    let i = tag.find(&format!("{name}=\""))? + name.len() + 2;
    let end = tag[i..].find('"')?;
    Some(xml_unescape(&tag[i..i + end]))
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn xml_unescape(s: &str) -> String {
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

fn percent_decode(s: &str) -> String {
    percent_encoding::percent_decode_str(s)
        .decode_utf8_lossy()
        .into_owned()
}

fn random_bytes(len: usize) -> Vec<u8> {
    let mut bytes = vec![0u8; len];
    getrandom::fill(&mut bytes).expect("system random number generator");
    bytes
}

fn random_hex(len: usize) -> String {
    random_bytes(len)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// The current UTC time as ONVIF wants it, e.g. 2026-10-30T09:40:00Z.
fn now_utc() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = (secs / 86400) as i64;
    let (h, m, s) = ((secs / 3600) % 24, (secs / 60) % 60, secs % 60);
    // Civil from days, H. Hinnant's algorithm.
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z.rem_euclid(146097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(mo <= 2);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}Z")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_probe_match() {
        let xml = r#"<SOAP-ENV:Envelope><SOAP-ENV:Body><d:ProbeMatches><d:ProbeMatch>
            <d:Scopes>onvif://www.onvif.org/type/video_encoder onvif://www.onvif.org/name/Reolink onvif://www.onvif.org/hardware/E1%20Zoom</d:Scopes>
            <d:XAddrs>http://[fe80::1]:8000/onvif/device_service http://192.168.178.183:8000/onvif/device_service</d:XAddrs>
            </d:ProbeMatch></d:ProbeMatches></SOAP-ENV:Body></SOAP-ENV:Envelope>"#;
        let camera = parse_probe_match(xml, "192.168.178.183:3702".parse().unwrap()).unwrap();
        assert_eq!(camera.host, "192.168.178.183");
        assert_eq!(camera.name.as_deref(), Some("Reolink"));
        assert_eq!(camera.hardware.as_deref(), Some("E1 Zoom"));
        assert_eq!(
            camera.onvif_url.as_deref(),
            Some("http://192.168.178.183:8000/onvif/device_service")
        );
    }

    #[test]
    fn parses_profiles() {
        let xml = r#"<trt:GetProfilesResponse>
            <trt:Profiles token="000" fixed="true"><tt:Name>mainStream</tt:Name>
              <tt:VideoEncoderConfiguration token="000"><tt:Name>ve</tt:Name><tt:Resolution><tt:Width>2560</tt:Width><tt:Height>1920</tt:Height></tt:Resolution></tt:VideoEncoderConfiguration>
            </trt:Profiles>
            <trt:Profiles token="001"><tt:Name>subStream</tt:Name>
              <tt:VideoEncoderConfiguration><tt:Resolution><tt:Width>640</tt:Width><tt:Height>480</tt:Height></tt:Resolution></tt:VideoEncoderConfiguration>
            </trt:Profiles></trt:GetProfilesResponse>"#;
        let profiles = parse_profiles(xml);
        assert_eq!(profiles.len(), 2);
        assert_eq!(profiles[0].token, "000");
        assert_eq!(profiles[0].name, "mainStream");
        assert_eq!(
            (profiles[0].width, profiles[0].height),
            (Some(2560), Some(1920))
        );
        assert_eq!(profiles[1].token, "001");
        assert_eq!(profiles[1].width, Some(640));
    }

    #[test]
    fn digest_matches_the_onvif_spec_example() {
        // Example from the ONVIF Application Programmer's Guide, 6.1.1.3.
        let nonce = base64::engine::general_purpose::STANDARD
            .decode("LKqI6G/AikKCQrN0zqZFlg==")
            .unwrap();
        let header = security_header("admin", "userpassword", &nonce, "2010-09-16T07:50:45Z");
        assert!(
            header.contains(">tuOSpGlFlIXsozq4HFNeeGeFLEI=<"),
            "{header}"
        );
    }

    #[test]
    fn inserts_the_login_encoded() {
        assert_eq!(
            with_login(
                "rtsp://192.168.1.5:554/h264Preview_01_main",
                "admin",
                "p@ss$w:rd"
            ),
            "rtsp://admin:p%40ss$w%3Ard@192.168.1.5:554/h264Preview_01_main"
        );
        assert_eq!(
            with_login("rtsp://u:x@h/s", "admin", "pw"),
            "rtsp://admin:pw@h/s"
        );
    }

    #[test]
    fn only_local_onvif_hosts() {
        assert!(is_local_host(
            &url::Url::parse("http://192.168.1.5:8000/").unwrap()
        ));
        assert!(is_local_host(
            &url::Url::parse("http://cam.local/").unwrap()
        ));
        assert!(!is_local_host(&url::Url::parse("http://8.8.8.8/").unwrap()));
        assert!(!is_local_host(
            &url::Url::parse("http://example.com/").unwrap()
        ));
    }

    #[test]
    fn formats_utc_time() {
        assert_eq!(now_utc().len(), 20);
        assert!(now_utc().ends_with('Z'));
    }
}
