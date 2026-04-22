/**
 * Shared HTTP helper for Vastify middleware callouts.
 * Reads base URL + API key from Vastify_Setting__mdt.Default.
 */
public with sharing class VastifyCallout {
    private static final String SETTING_NAME = 'Default';

    public class VastifyException extends Exception {}

    public static Vastify_Setting__mdt getSetting() {
        Vastify_Setting__mdt s = Vastify_Setting__mdt.getInstance(SETTING_NAME);
        if (s == null) {
            throw new VastifyException('Vastify_Setting__mdt.' + SETTING_NAME + ' is missing. Create it in Setup.');
        }
        return s;
    }

    public static HttpResponse post(String path, String jsonBody) {
        Vastify_Setting__mdt s = getSetting();
        HttpRequest req = new HttpRequest();
        req.setEndpoint(s.Api_Url__c + path);
        req.setMethod('POST');
        req.setHeader('Content-Type', 'application/json');
        req.setHeader('X-Vastify-Api-Key', s.Api_Key__c);
        req.setBody(jsonBody);
        req.setTimeout(120000);
        return new Http().send(req);
    }

    public static HttpResponse get(String path) {
        Vastify_Setting__mdt s = getSetting();
        HttpRequest req = new HttpRequest();
        req.setEndpoint(s.Api_Url__c + path);
        req.setMethod('GET');
        req.setHeader('X-Vastify-Api-Key', s.Api_Key__c);
        req.setTimeout(60000);
        return new Http().send(req);
    }

    public static Map<String, Object> expectJson(HttpResponse resp) {
        if (resp.getStatusCode() < 200 || resp.getStatusCode() >= 300) {
            throw new VastifyException('Vastify HTTP ' + resp.getStatusCode() + ': ' + resp.getBody());
        }
        return (Map<String, Object>) JSON.deserializeUntyped(resp.getBody());
    }
}
