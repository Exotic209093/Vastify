export function renderMetadataXml(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx" Version="4.0">
  <edmx:DataServices>
    <Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="Vastify">
      <EntityType Name="Interaction">
        <Key><PropertyRef Name="Id"/></Key>
        <Property Name="Id"         Type="Edm.String"         Nullable="false"/>
        <Property Name="Timestamp"  Type="Edm.DateTimeOffset" Nullable="true"/>
        <Property Name="Channel"    Type="Edm.String"         Nullable="true" MaxLength="40"/>
        <Property Name="Type"       Type="Edm.String"         Nullable="true" MaxLength="40"/>
        <Property Name="AccountId"  Type="Edm.String"         Nullable="true" MaxLength="40"/>
        <Property Name="ContactId"  Type="Edm.String"         Nullable="true" MaxLength="40"/>
        <Property Name="Subject"    Type="Edm.String"         Nullable="true" MaxLength="255"/>
        <Property Name="Payload"    Type="Edm.String"         Nullable="true"/>
        <Property Name="IsArchived" Type="Edm.Boolean"        Nullable="false"/>
      </EntityType>
      <EntityType Name="ArchivedInteraction">
        <Key><PropertyRef Name="Id"/></Key>
        <Property Name="Id"         Type="Edm.String"         Nullable="false"/>
        <Property Name="Timestamp"  Type="Edm.DateTimeOffset" Nullable="true"/>
        <Property Name="Channel"    Type="Edm.String"         Nullable="true" MaxLength="40"/>
        <Property Name="Type"       Type="Edm.String"         Nullable="true" MaxLength="40"/>
        <Property Name="AccountId"  Type="Edm.String"         Nullable="true" MaxLength="40"/>
        <Property Name="ContactId"  Type="Edm.String"         Nullable="true" MaxLength="40"/>
        <Property Name="Subject"    Type="Edm.String"         Nullable="true" MaxLength="255"/>
        <Property Name="Payload"    Type="Edm.String"         Nullable="true"/>
        <Property Name="IsArchived" Type="Edm.Boolean"        Nullable="false"/>
      </EntityType>
      <EntityContainer Name="Container">
        <EntitySet Name="Interaction"         EntityType="Vastify.Interaction"/>
        <EntitySet Name="ArchivedInteraction" EntityType="Vastify.ArchivedInteraction"/>
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`;
}

export function renderServiceDoc(baseUrl: string): string {
  return JSON.stringify(
    {
      '@odata.context': `${baseUrl}/$metadata`,
      value: [
        { name: 'Interaction', kind: 'EntitySet', url: 'Interaction' },
        { name: 'ArchivedInteraction', kind: 'EntitySet', url: 'ArchivedInteraction' },
      ],
    },
    null,
    2,
  );
}
