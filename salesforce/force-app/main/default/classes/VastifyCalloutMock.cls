@IsTest
public class VastifyCalloutMock implements HttpCalloutMock {
    public Integer statusCode = 200;
    public String bodyText;

    public VastifyCalloutMock(Integer status, String body) {
        this.statusCode = status;
        this.bodyText = body;
    }

    public HttpResponse respond(HttpRequest req) {
        HttpResponse r = new HttpResponse();
        r.setStatusCode(statusCode);
        r.setBody(bodyText);
        r.setHeader('Content-Type', 'application/json');
        return r;
    }
}
