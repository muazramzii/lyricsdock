//! HTTP adapter for the bridge, bound strictly to 127.0.0.1.

use super::core::Request;
use super::schema::MAX_BODY_BYTES;
use super::{Bridge, PORTS};
use std::io::Read;
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};
use std::sync::Arc;
use tiny_http::{Header, Response, Server};

const WORKERS: usize = 2;

fn header(req: &tiny_http::Request, name: &str) -> Option<String> {
    req.headers()
        .iter()
        .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name))
        .map(|h| h.value.as_str().to_string())
}

fn bind() -> Result<(Server, u16), String> {
    let mut last_err = String::new();
    for port in PORTS {
        // Never 0.0.0.0: the bridge must not be reachable from the network.
        let addr = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port));
        match Server::http(addr) {
            Ok(s) => return Ok((s, port)),
            Err(e) => last_err = e.to_string(),
        }
    }
    Err(format!(
        "Ports {}-{} are all in use ({last_err})",
        PORTS[0],
        PORTS[PORTS.len() - 1]
    ))
}

pub fn spawn(bridge: Arc<Bridge>) {
    let (server, port) = match bind() {
        Ok(v) => v,
        Err(e) => {
            log::error!("bridge could not start: {e}");
            bridge.set_listening(None, Some(e));
            return;
        }
    };
    log::info!("bridge listening on 127.0.0.1:{port}");
    bridge.set_listening(Some(port), None);
    let server = Arc::new(server);
    for i in 0..WORKERS {
        let server = Arc::clone(&server);
        let bridge = Arc::clone(&bridge);
        std::thread::Builder::new()
            .name(format!("bridge-http-{i}"))
            .spawn(move || {
                for rq in server.incoming_requests() {
                    serve(&bridge, rq);
                }
            })
            .expect("spawn bridge worker");
    }
}

fn serve(bridge: &Bridge, mut rq: tiny_http::Request) {
    let mut body = Vec::with_capacity(512);
    let declared_len = rq.body_length().unwrap_or(0);
    let too_large_declared = declared_len > MAX_BODY_BYTES;
    if !too_large_declared {
        let _ = rq
            .as_reader()
            .take(MAX_BODY_BYTES as u64 + 1)
            .read_to_end(&mut body);
    }
    let req = Request {
        method: rq.method().as_str().to_ascii_uppercase(),
        path: rq.url().split('?').next().unwrap_or("").to_string(),
        host: header(&rq, "Host"),
        origin: header(&rq, "Origin"),
        content_type: header(&rq, "Content-Type"),
        authorization: header(&rq, "Authorization"),
        body_too_large: too_large_declared || body.len() > MAX_BODY_BYTES,
        body,
    };
    let resp = bridge.handle(&req);
    let json = resp.body.to_string();
    let mut response = Response::from_string(json).with_status_code(resp.status);
    for (k, v) in [
        ("Content-Type", "application/json"),
        ("Cache-Control", "no-store"),
        ("X-Content-Type-Options", "nosniff"),
    ] {
        if let Ok(h) = Header::from_bytes(k.as_bytes(), v.as_bytes()) {
            response.add_header(h);
        }
    }
    let _ = rq.respond(response);
}
