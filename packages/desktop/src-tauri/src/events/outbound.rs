use serde_json::{json, Value};

fn coords(index: usize, cols: u32) -> (u32, u32) {
    ((index as u32) % cols, (index as u32) / cols)
}

fn base(event: &str, action_uuid: &str, context: &str) -> Value {
    json!({ "event": event, "action": action_uuid, "context": context, "device": "main" })
}

pub fn key_down_with_settings(action_uuid: &str, context: &str, settings: &Value, index: usize, cols: u32) -> Value {
    let (col, row) = coords(index, cols);
    let mut m = base("keyDown", action_uuid, context);
    m["payload"] = json!({
        "settings": settings,
        "coordinates": { "column": col, "row": row },
        "state": 0, "isInMultiAction": false
    });
    m
}

pub fn key_up_with_settings(action_uuid: &str, context: &str, settings: &Value, index: usize, cols: u32) -> Value {
    let (col, row) = coords(index, cols);
    let mut m = base("keyUp", action_uuid, context);
    m["payload"] = json!({
        "settings": settings,
        "coordinates": { "column": col, "row": row },
        "state": 0, "isInMultiAction": false
    });
    m
}

pub fn will_appear(action_uuid: &str, context: &str, settings: &Value, index: usize, cols: u32) -> Value {
    let (col, row) = coords(index, cols);
    let mut m = base("willAppear", action_uuid, context);
    m["payload"] = json!({
        "settings": settings,
        "coordinates": { "column": col, "row": row },
        "state": 0, "isInMultiAction": false
    });
    m
}

pub fn will_disappear(action_uuid: &str, context: &str, settings: &Value, index: usize, cols: u32) -> Value {
    let (col, row) = coords(index, cols);
    let mut m = base("willDisappear", action_uuid, context);
    m["payload"] = json!({
        "settings": settings,
        "coordinates": { "column": col, "row": row },
        "state": 0, "isInMultiAction": false
    });
    m
}

pub fn device_did_connect(cols: u32, rows: u32) -> Value {
    json!({
        "event": "deviceDidConnect",
        "device": "main",
        "deviceInfo": {
            "name": "Panna Cotta",
            "type": 0,
            "size": { "columns": cols, "rows": rows }
        }
    })
}

pub fn did_receive_settings(action_uuid: &str, context: &str, settings: &Value) -> Value {
    let mut m = base("didReceiveSettings", action_uuid, context);
    m["payload"] = json!({ "settings": settings, "isInMultiAction": false });
    m
}

pub fn send_to_plugin(context: &str, payload: &Value) -> Value {
    json!({ "event": "sendToPlugin", "context": context, "payload": payload })
}

pub fn send_to_property_inspector(action_uuid: &str, context: &str, payload: &Value) -> Value {
    let mut m = base("sendToPropertyInspector", action_uuid, context);
    m["payload"] = payload.clone();
    m
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_down_payload_shape() {
        let msg = key_down_with_settings("com.ex.action", "ctx123", &serde_json::json!({}), 0, 5);
        assert_eq!(msg["event"], "keyDown");
        assert_eq!(msg["action"], "com.ex.action");
        assert_eq!(msg["context"], "ctx123");
        assert_eq!(msg["device"], "main");
        assert_eq!(msg["payload"]["coordinates"]["column"], 0);
        assert_eq!(msg["payload"]["coordinates"]["row"], 0);
        assert_eq!(msg["payload"]["isInMultiAction"], false);
    }

    #[test]
    fn coords_wraps_by_cols() {
        // index 7 with 5 cols: col=2, row=1
        let msg = key_down_with_settings("a", "b", &serde_json::json!({}), 7, 5);
        assert_eq!(msg["payload"]["coordinates"]["column"], 2);
        assert_eq!(msg["payload"]["coordinates"]["row"], 1);
    }

    #[test]
    fn will_appear_includes_settings() {
        let settings = serde_json::json!({"appName": "Calc"});
        let msg = will_appear("a", "b", &settings, 0, 3);
        assert_eq!(msg["event"], "willAppear");
        assert_eq!(msg["payload"]["settings"]["appName"], "Calc");
    }

    #[test]
    fn device_did_connect_shape() {
        let msg = device_did_connect(5, 3);
        assert_eq!(msg["event"], "deviceDidConnect");
        assert_eq!(msg["device"], "main");
        assert_eq!(msg["deviceInfo"]["size"]["columns"], 5);
        assert_eq!(msg["deviceInfo"]["size"]["rows"], 3);
    }

    #[test]
    fn send_to_plugin_shape() {
        let msg = send_to_plugin("ctx1", &serde_json::json!({"x":1}));
        assert_eq!(msg["event"], "sendToPlugin");
        assert_eq!(msg["payload"]["x"], 1);
    }
}
